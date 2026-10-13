import {
  creationIssues,
  type ImportCommitInput,
  type ImportGroup,
  type ImportIssue,
  type ImportLine,
  type ImportSummary,
  type ImportValidateInput,
  type ImportValidationDto,
  interpretImportRows,
  newVariantIssues,
  type PermissionCode,
  type ProductType,
  typeIssues,
  variantKey,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, ERROR_MESSAGES } from '../../core/errors.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { findBrand, findCategory, resolveBrand, resolveCategory } from './catalogs.js';
import { HISTORY_COUNT, hasHistory } from './products.repository.js';

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export interface ImportActor {
  userId: string;
  permissions: readonly PermissionCode[];
  ip: string | null;
}

const NOTE = 'Carga masiva';
const SKU_TAKEN = ERROR_MESSAGES.SKU_TAKEN;

type ExistingProduct = Prisma.ProductGetPayload<{
  include: { variants: { include: typeof HISTORY_COUNT } };
}>;
type ExistingVariant = ExistingProduct['variants'][number];

interface RackInfo {
  id: string;
  locationCode: string;
  capacityUnits: number;
  isActive: boolean;
  isStaging: boolean;
}

interface PlannedLine {
  line: ImportLine;
  /** Variante existente que actualiza (o `null` si se crea). */
  variant: ExistingVariant | null;
  /** Rack que recibe la existencia (si la hay y es válida). */
  rack: RackInfo | null;
}

interface PlannedGroup {
  group: ImportGroup;
  existing: ExistingProduct | null;
  type: ProductType;
  /** Cambio de tipo sin historial: se reemplazan las variantes. */
  replaceVariants: boolean;
  lines: PlannedLine[];
}

interface Plan {
  issues: ImportIssue[];
  summary: ImportSummary;
  groups: PlannedGroup[];
  /** Racks que exceden la capacidad con permiso y casilla. */
  overriddenRacks: Set<string>;
}

const attrsAfter = (variant: ExistingVariant | null, line: ImportLine) => ({
  size: line.size === undefined ? (variant?.size ?? null) : line.size,
  color: line.color === undefined ? (variant?.color ?? null) : line.color,
  material: line.material === undefined ? (variant?.material ?? null) : line.material,
});

/** Carga masiva: validación contra la BD y aplicación todo o nada (spec F6 §3). */
export class ImportService {
  private readonly inventory = new InventoryService();

  constructor(private readonly app: FastifyInstance) {}

  async validate(
    input: ImportValidateInput,
    actor: ImportActor,
    branchId: string,
  ): Promise<ImportValidationDto> {
    const { issues, summary } = await this.plan(this.app.prisma, input, actor, branchId);
    return { issues, summary };
  }

  async commit(
    input: ImportCommitInput,
    actor: ImportActor,
    branchId: string,
  ): Promise<ImportSummary> {
    return this.app.prisma.$transaction(
      async (tx) => {
        const plan = await this.plan(tx, input, actor, branchId);
        if (plan.issues.length > 0) {
          throw new DomainError('IMPORT_INVALID', { details: plan.issues });
        }
        if (plan.summary.stock.addingToExisting.units > 0 && !input.confirmStockAddition) {
          throw new DomainError('IMPORT_CONFIRMATION_REQUIRED', { details: plan.summary });
        }
        await this.apply(tx, plan, actor);
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'product.import',
            entity: 'Product',
            payload: plan.summary,
            ip: actor.ip,
          },
          tx,
        );
        return plan.summary;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  private async plan(
    db: Db,
    input: ImportValidateInput,
    actor: ImportActor,
    branchId: string,
  ): Promise<Plan> {
    const { issues, groups } = interpretImportRows(input.rows);
    const issue = (rowNumber: number, field: ImportIssue['field'], message: string) =>
      issues.push({ rowNumber, field, message });

    const skus = [
      ...new Set(
        groups.flatMap((g) => [g.parentSku, ...g.lines.flatMap((l) => (l.sku ? [l.sku] : []))]),
      ),
    ];
    const [products, variants] = await Promise.all([
      db.product.findMany({
        where: { sku: { in: skus } },
        include: { variants: { include: HISTORY_COUNT } },
      }),
      db.productVariant.findMany({
        where: { sku: { in: skus } },
        select: { sku: true, productId: true },
      }),
    ]);
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const variantBySku = new Map(variants.map((v) => [v.sku, v]));

    const planned: PlannedGroup[] = [];
    for (const group of groups) {
      const firstRow = group.lines[0]!.rowNumber;
      const existing = productBySku.get(group.parentSku) ?? null;
      const fileType = group.product.type;
      let replaceVariants = false;

      if (!existing) {
        const usedByVariant = variantBySku.get(group.parentSku);
        if (usedByVariant) issue(firstRow, 'sku_padre', SKU_TAKEN);
        issues.push(...creationIssues(group, (line) => !line.sku || !variantBySku.has(line.sku)));
      } else {
        if (fileType === undefined) issues.push(...typeIssues(group, existing.type));
        if (fileType && fileType !== existing.type) {
          if (existing.variants.some(hasHistory)) {
            issue(group.productRows.type!, 'tipo', ERROR_MESSAGES.PRODUCT_TYPE_LOCKED);
          } else {
            replaceVariants = true;
          }
        }
      }
      const type = fileType ?? existing?.type;
      if (!type) continue;

      const own = new Map(
        replaceVariants ? [] : (existing?.variants ?? []).map((v) => [v.sku, v] as const),
      );
      if (existing && type === 'VARIABLE') {
        issues.push(
          ...newVariantIssues(group, (line) => replaceVariants || !own.has(line.sku ?? '')),
        );
      }

      const lines: PlannedLine[] = group.lines.map((line) => {
        if (type === 'SIMPLE') {
          return {
            line,
            variant: replaceVariants ? null : (existing?.variants[0] ?? null),
            rack: null,
          };
        }
        if (line.sku) {
          const variant = variantBySku.get(line.sku);
          if (variant && variant.productId !== existing?.id) {
            issue(line.rowNumber, 'sku_variante', SKU_TAKEN);
          }
          const product = productBySku.get(line.sku);
          if (product && product.id !== existing?.id)
            issue(line.rowNumber, 'sku_variante', SKU_TAKEN);
        }
        return { line, variant: own.get(line.sku ?? '') ?? null, rack: null };
      });

      if (type === 'VARIABLE') {
        // Combinaciones finales del producto, sin distinguir mayúsculas.
        const final = new Map<string, string>(); // variantKey → SKU
        const touched = new Set(lines.map((l) => l.variant?.id).filter(Boolean));
        for (const variant of own.values()) {
          if (!touched.has(variant.id)) final.set(variantKey(variant), variant.sku);
        }
        for (const { line, variant } of lines) {
          const attrs = attrsAfter(variant, line);
          if (variant && !attrs.size && !attrs.color && !attrs.material) {
            issue(line.rowNumber, 'talla', 'La variante necesita talla, color o material');
            continue;
          }
          const key = variantKey(attrs);
          if (key === '||') continue;
          if (final.has(key)) {
            issue(
              line.rowNumber,
              'talla',
              `Esa combinación ya existe en el producto (${final.get(key)})`,
            );
          } else {
            final.set(key, line.sku ?? '');
          }
        }
      }
      planned.push({ group, existing, type, replaceVariants, lines });
    }

    const overriddenRacks = await this.planStock(db, planned, input, actor, branchId, issue);
    const summary = await this.summarize(db, planned, branchId);
    issues.sort((a, b) => a.rowNumber - b.rowNumber);
    return { issues, summary, groups: planned, overriddenRacks };
  }

  /** Permiso, rack de destino y capacidad de cada fila con existencia. */
  private async planStock(
    db: Db,
    groups: PlannedGroup[],
    input: ImportValidateInput,
    actor: ImportActor,
    branchId: string,
    issue: (rowNumber: number, field: ImportIssue['field'], message: string) => void,
  ): Promise<Set<string>> {
    const withStock = groups.flatMap((g) => g.lines).filter((l) => l.line.stock > 0);
    const overridden = new Set<string>();
    if (withStock.length === 0) return overridden;

    const warehouse = await db.warehouse.findFirst({
      where: { branchId, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    const codes = [
      ...new Set(withStock.flatMap((l) => (l.line.location ? [l.line.location] : []))),
    ];
    const rows = warehouse
      ? await db.rack.findMany({
          where: {
            warehouseId: warehouse.id,
            OR: [
              { locationCode: { in: codes } },
              { isActive: true, container: { zone: { isStaging: true, isActive: true } } },
            ],
          },
          include: { container: { include: { zone: { select: { isStaging: true } } } } },
          orderBy: { locationCode: 'asc' },
        })
      : [];
    const racks = rows.map((r): RackInfo => ({
      id: r.id,
      locationCode: r.locationCode,
      capacityUnits: r.capacityUnits,
      isActive: r.isActive,
      isStaging: r.container.zone.isStaging,
    }));
    const byCode = new Map(racks.map((r) => [r.locationCode, r]));
    const staging = racks.find((r) => r.isStaging && r.isActive) ?? null;
    const canPutaway = actor.permissions.includes('inventory.putaway');

    const requested = new Map<string, { rack: RackInfo; units: number; rows: number[] }>();
    for (const planned of withStock) {
      const { line } = planned;
      if (!canPutaway) {
        issue(
          line.rowNumber,
          'existencia',
          'Necesitas el permiso "Ubicar productos" para cargar existencia',
        );
        continue;
      }
      const rack = line.location ? byCode.get(line.location) : staging;
      if (!rack) {
        issue(
          line.rowNumber,
          'ubicación',
          line.location ? 'La ubicación no existe en el almacén' : 'El almacén no tiene staging',
        );
        continue;
      }
      if (!rack.isActive) {
        issue(line.rowNumber, 'ubicación', 'La ubicación está inactiva');
        continue;
      }
      planned.rack = rack;
      if (rack.isStaging) continue;
      const entry = requested.get(rack.id) ?? { rack, units: 0, rows: [] };
      entry.units += line.stock;
      entry.rows.push(line.rowNumber);
      requested.set(rack.id, entry);
    }

    if (requested.size > 0) {
      const occupied = await db.stockLocation.groupBy({
        by: ['rackId'],
        where: { rackId: { in: [...requested.keys()] } },
        _sum: { quantity: true },
      });
      const occupiedBy = new Map(occupied.map((o) => [o.rackId, o._sum.quantity ?? 0]));
      const canOverride =
        input.allowCapacityOverride && actor.permissions.includes('inventory.override_capacity');
      for (const { rack, units, rows: rowNumbers } of requested.values()) {
        const current = occupiedBy.get(rack.id) ?? 0;
        if (current + units <= rack.capacityUnits) continue;
        if (canOverride) {
          overridden.add(rack.id);
          continue;
        }
        for (const rowNumber of rowNumbers) {
          issue(
            rowNumber,
            'ubicación',
            `Excede la capacidad de ${rack.locationCode}: ${current} de ${rack.capacityUnits} ocupadas y se agregan ${units}`,
          );
        }
      }
    }
    return overridden;
  }

  private async summarize(
    db: Db,
    groups: PlannedGroup[],
    branchId: string,
  ): Promise<ImportSummary> {
    const lines = groups.flatMap((g) => g.lines);
    const stocked = lines.filter((l) => l.rack && l.line.stock > 0);

    const existingIds = stocked.flatMap((l) => (l.variant ? [l.variant.id] : []));
    const current = existingIds.length
      ? await db.stockLocation.groupBy({
          by: ['variantId'],
          where: { variantId: { in: existingIds }, rack: { warehouse: { branchId } } },
          _sum: { quantity: true },
        })
      : [];
    const withStock = new Set(
      current.filter((c) => (c._sum.quantity ?? 0) > 0).map((c) => c.variantId),
    );
    const adding = stocked.filter((l) => l.variant && withStock.has(l.variant.id));

    const distinct = (values: (string | null | undefined)[]) => {
      const seen = new Map<string, string>();
      for (const value of values)
        if (value) seen.set(value.toLowerCase(), seen.get(value.toLowerCase()) ?? value);
      return [...seen.values()];
    };
    const categories = distinct(groups.map((g) => g.group.product.category));
    const brands = distinct(groups.map((g) => g.group.product.brand));
    const missingCategories: string[] = [];
    for (const path of categories)
      if (!(await findCategory(db, path))) missingCategories.push(path);
    const missingBrands: string[] = [];
    for (const name of brands) if (!(await findBrand(db, name))) missingBrands.push(name);

    const sum = (list: PlannedLine[]) => list.reduce((total, l) => total + l.line.stock, 0);
    return {
      productsToCreate: groups.filter((g) => !g.existing).length,
      productsToUpdate: groups.filter((g) => g.existing).length,
      variantsToCreate: lines.filter((l) => !l.variant).length,
      variantsToUpdate: lines.filter((l) => l.variant).length,
      categoriesToCreate: missingCategories,
      brandsToCreate: missingBrands,
      stock: {
        units: sum(stocked),
        rows: stocked.length,
        unitsToStaging: sum(stocked.filter((l) => l.rack!.isStaging)),
        addingToExisting: { units: sum(adding), variants: adding.length },
      },
    };
  }

  private async apply(tx: Tx, plan: Plan, actor: ImportActor): Promise<void> {
    for (const { group, existing, type, replaceVariants, lines } of plan.groups) {
      const fields = group.product;
      const categoryId =
        fields.category === undefined
          ? undefined
          : fields.category && (await resolveCategory(tx, fields.category));
      const brandId =
        fields.brand === undefined
          ? undefined
          : fields.brand && (await resolveBrand(tx, fields.brand));
      const data = {
        name: fields.name,
        type,
        price: fields.price,
        cost: fields.cost,
        categoryId,
        brandId,
        isActive: fields.isActive,
      };
      const product = existing
        ? await tx.product.update({ where: { id: existing.id }, data })
        : await tx.product.create({
            data: {
              ...data,
              sku: group.parentSku,
              name: fields.name!,
              price: fields.price!,
              isActive: fields.isActive ?? true,
            },
          });
      if (replaceVariants) {
        await tx.productVariant.deleteMany({ where: { productId: product.id } });
      }

      for (const planned of lines) {
        const { line, variant } = planned;
        const attrs =
          type === 'SIMPLE' ? {} : { size: line.size, color: line.color, material: line.material };
        const values = { ...attrs, priceOverride: line.priceOverride };
        const variantId = variant
          ? (await tx.productVariant.update({ where: { id: variant.id }, data: values })).id
          : (
              await tx.productVariant.create({
                data: {
                  productId: product.id,
                  sku: type === 'SIMPLE' ? group.parentSku : line.sku!,
                  size: type === 'SIMPLE' ? null : (line.size ?? null),
                  color: type === 'SIMPLE' ? null : (line.color ?? null),
                  material: type === 'SIMPLE' ? null : (line.material ?? null),
                  priceOverride: line.priceOverride ?? null,
                },
              })
            ).id;

        if (planned.rack && line.stock > 0) {
          const hadMovements = (variant?._count.inventoryMovements ?? 0) > 0;
          await this.inventory.receive(tx, {
            type: hadMovements ? 'PUTAWAY' : 'INITIAL_LOAD',
            variantId,
            rackId: planned.rack.id,
            quantity: line.stock,
            userId: actor.userId,
            note: NOTE,
            overrideCapacity: plan.overriddenRacks.has(planned.rack.id),
          });
        }
      }
    }
  }
}
