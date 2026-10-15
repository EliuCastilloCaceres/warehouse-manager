import {
  type ContentQuery,
  LOCATION_QR_PREFIX,
  type MovementListQuery,
  type MovementPageDto,
  type MovementRowDto,
  normalizeSku,
  type LocateResultDto,
  type LocationRowDto,
  type NodeContentDto,
  occupancyLevel,
  type OtherBranchStockDto,
  parseLocationCode,
  type PermissionCode,
  type SuggestionDto,
  type SuggestionsDto,
  SUGGESTIONS_MAX,
  type VariantDetailDto,
  variantLabel,
  variantStockStatus,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import { buildPage, toPrismaPage } from '../../core/pagination.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ProductsService } from '../products/products.service.js';
import { TreeService } from '../warehouse/tree.service.js';

type Db = PrismaClient | Prisma.TransactionClient;

interface LocationRow extends LocationRowDto {
  variantId: string;
}

/** Ubicaciones con unidades de las variantes en la sucursal; staging al final. */
function locationsOf(db: Db, variantIds: string[], branchId: string): Promise<LocationRow[]> {
  return db.$queryRaw<LocationRow[]>`
    SELECT s.variant_id AS "variantId", r.id AS "rackId", r.location_code AS "locationCode",
           z.name AS "zoneName", COALESCE(r.label_color, z.color) AS "colorHex",
           z.is_staging AS "isStaging", s.quantity, s.reserved_qty AS "reservedQty",
           (s.quantity - s.reserved_qty)::int AS available
    FROM stock_location s
    JOIN rack r ON r.id = s.rack_id
    JOIN container c ON c.id = r.container_id
    JOIN zone z ON z.id = c.zone_id
    JOIN warehouse w ON w.id = r.warehouse_id
    WHERE w.branch_id = ${branchId}::uuid AND s.variant_id = ANY(${variantIds}::uuid[])
      AND s.quantity > 0
    ORDER BY z.is_staging, r.location_code`;
}

/**
 * Disponibles de cada variante en las **otras** sucursales activas (spec F7 §3): Σ(quantity −
 * reservedQty) de sus almacenes activos, incluido staging; solo las que tienen > 0, de mayor a
 * menor. Es de solo lectura: incluye sucursales que el actor no tiene asignadas. F8 la reutiliza.
 */
export async function otherBranchesStock(
  db: Db,
  variantIds: readonly string[],
  currentBranchId: string,
): Promise<Map<string, OtherBranchStockDto[]>> {
  const result = new Map<string, OtherBranchStockDto[]>(variantIds.map((id) => [id, []]));
  if (variantIds.length === 0) return result;
  const rows = await db.$queryRaw<(OtherBranchStockDto & { variantId: string })[]>`
    SELECT s.variant_id AS "variantId", b.id AS "branchId", b.code, b.name, b.phone,
           SUM(s.quantity - s.reserved_qty)::int AS available
    FROM stock_location s
    JOIN rack r ON r.id = s.rack_id
    JOIN warehouse w ON w.id = r.warehouse_id
    JOIN branch b ON b.id = w.branch_id
    WHERE s.variant_id = ANY(${[...variantIds]}::uuid[])
      AND b.id <> ${currentBranchId}::uuid AND b.is_active AND w.is_active
    GROUP BY s.variant_id, b.id
    HAVING SUM(s.quantity - s.reserved_qty) > 0
    ORDER BY available DESC, b.code`;
  for (const { variantId, ...branch } of rows) result.get(variantId)?.push(branch);
  return result;
}

interface SuggestionRow {
  rackId: string;
  locationCode: string;
  zoneName: string;
  colorHex: string | null;
  capacity: number;
  occupied: number;
  free: number;
  priority: number;
  sortOrder: number;
  sameVariant: boolean;
  sameProduct: boolean;
}

const REASON_RANK = { SAME_VARIANT: 0, SAME_PRODUCT: 1, FREE_SPACE: 2 } as const;

/** Consultas de inventario: buscar, contenido por código y sugerencias (spec F7 §3). */
export class InventoryQueries {
  private readonly products: ProductsService;
  private readonly tree: TreeService;

  constructor(private readonly app: FastifyInstance) {
    this.products = new ProductsService(app);
    this.tree = new TreeService(app);
  }

  private get prisma() {
    return this.app.prisma;
  }

  /** Dónde está una variante (o las de un SKU padre) en la sucursal y, con permiso, en las demás. */
  async locate(
    code: string,
    branchId: string,
    permissions: readonly PermissionCode[],
  ): Promise<LocateResultDto> {
    const found = await this.products.lookup(code, branchId);
    const variants: VariantDetailDto[] =
      found.match === 'variant' ? [found.variant] : found.variants;
    const ids = variants.map((variant) => variant.id);
    const [branch, locations, others] = await Promise.all([
      this.prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { lowStockThreshold: true },
      }),
      locationsOf(this.prisma, ids, branchId),
      permissions.includes('inventory.other_branches.read')
        ? otherBranchesStock(this.prisma, ids, branchId)
        : Promise.resolve(null),
    ]);
    return {
      product: found.product,
      variants: variants.map((variant) => {
        const rows = locations.filter((l) => l.variantId === variant.id);
        const stagingQuantity = rows.filter((l) => l.isStaging).reduce((s, l) => s + l.quantity, 0);
        return {
          variant,
          totals: variant.stock,
          stock: variantStockStatus(
            { ...variant.stock, stagingQuantity },
            branch.lowStockThreshold,
          ),
          // La respuesta (`LocationRowDto`) descarta `variantId`.
          locations: rows,
          otherBranches: others ? others.get(variant.id)! : null,
        };
      }),
    };
  }

  /** Contenido del rack con ese código (`A-01-03`, `a-1-3` o `LOC:A-01-03`) en la sucursal. */
  async byLocation(code: string, branchId: string, query: ContentQuery): Promise<NodeContentDto> {
    const raw = code.trim();
    const parsed = parseLocationCode(
      raw.toUpperCase().startsWith(LOCATION_QR_PREFIX) ? raw.slice(LOCATION_QR_PREFIX.length) : raw,
    );
    const rack =
      parsed &&
      (await this.prisma.rack.findFirst({
        where: { locationCode: parsed.code, warehouse: { branchId } },
        select: { id: true },
      }));
    if (!rack) {
      throw new DomainError('NOT_FOUND', { message: 'No existe esa ubicación en la sucursal.' });
    }
    return this.tree.rackContent(rack.id, branchId, query);
  }

  /**
   * Racks activos (sin staging) donde caben `quantity` unidades: primero los que ya tienen la
   * variante, luego los que tienen otra del mismo producto y luego el resto, por prioridad de
   * zona, orden y espacio libre. Si ninguno alcanza, los de más espacio con `fitsAll: false`.
   */
  async suggest(variantId: string, quantity: number, branchId: string): Promise<SuggestionsDto> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!variant) throw new DomainError('NOT_FOUND', { message: 'No se encontró el producto.' });
    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      SELECT o.rack_id AS "rackId", o.location_code AS "locationCode", z.name AS "zoneName",
             COALESCE(r.label_color, z.color) AS "colorHex", o.capacity_units AS capacity,
             o.occupied_units AS occupied, o.free_units AS free, z.priority,
             z.sort_order AS "sortOrder",
             EXISTS (SELECT 1 FROM stock_location s
                     WHERE s.rack_id = o.rack_id AND s.variant_id = ${variantId}::uuid
                       AND s.quantity > 0) AS "sameVariant",
             EXISTS (SELECT 1 FROM stock_location s
                     JOIN product_variant v ON v.id = s.variant_id
                     WHERE s.rack_id = o.rack_id AND v.product_id = ${variant.productId}::uuid
                       AND s.variant_id <> ${variantId}::uuid AND s.quantity > 0) AS "sameProduct"
      FROM v_rack_occupancy o
      JOIN rack r ON r.id = o.rack_id
      JOIN container c ON c.id = o.container_id
      JOIN zone z ON z.id = o.zone_id
      JOIN warehouse w ON w.id = o.warehouse_id
      WHERE w.branch_id = ${branchId}::uuid AND w.is_active AND o.is_active AND NOT o.is_staging
        AND c.is_active AND z.is_active`;

    const toDto = (row: SuggestionRow): SuggestionDto => ({
      rackId: row.rackId,
      locationCode: row.locationCode,
      zoneName: row.zoneName,
      colorHex: row.colorHex,
      free: row.free,
      level: occupancyLevel(row.occupied, row.capacity),
      reason: row.sameVariant ? 'SAME_VARIANT' : row.sameProduct ? 'SAME_PRODUCT' : 'FREE_SPACE',
    });
    const byLocation = (a: SuggestionRow, b: SuggestionRow) =>
      a.locationCode.localeCompare(b.locationCode);

    const fitting = rows
      .filter((row) => row.free >= quantity)
      .map((row) => ({ row, dto: toDto(row) }))
      .sort(
        (a, b) =>
          REASON_RANK[a.dto.reason] - REASON_RANK[b.dto.reason] ||
          a.row.priority - b.row.priority ||
          a.row.sortOrder - b.row.sortOrder ||
          b.row.free - a.row.free ||
          byLocation(a.row, b.row),
      );
    if (fitting.length > 0) {
      return { fitsAll: true, suggestions: fitting.slice(0, SUGGESTIONS_MAX).map((s) => s.dto) };
    }
    const roomiest = rows
      .filter((row) => row.free > 0)
      .sort((a, b) => b.free - a.free || byLocation(a, b))
      .slice(0, SUGGESTIONS_MAX);
    return { fitsAll: false, suggestions: roomiest.map(toDto) };
  }

  /**
   * Kardex de la sucursal: movimientos con origen o destino en sus almacenes, del más reciente al
   * más antiguo. `from`/`to` son días locales (inclusive) en la zona horaria de la sucursal.
   */
  async movements(query: MovementListQuery, branchId: string): Promise<MovementPageDto> {
    const { timezone } = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { timezone: true },
    });
    const page = toPrismaPage(query);
    const and: Prisma.InventoryMovementWhereInput[] = [
      {
        OR: [{ fromRack: { warehouse: { branchId } } }, { toRack: { warehouse: { branchId } } }],
      },
    ];
    if (query.variantId) and.push({ variantId: query.variantId });
    if (query.sku) {
      const sku = normalizeSku(query.sku);
      and.push({ variant: { OR: [{ sku }, { product: { sku } }] } });
    }
    if (query.q) {
      and.push({
        variant: {
          OR: [
            { sku: { contains: query.q, mode: 'insensitive' } },
            { product: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        },
      });
    }
    const rackId = query.rackId ?? (await this.rackIdOf(query.locationCode, branchId));
    if (rackId === null) return { ...buildPage<MovementRowDto>([], 0, query), timezone };
    if (rackId) and.push({ OR: [{ fromRackId: rackId }, { toRackId: rackId }] });
    if (query.types) and.push({ type: { in: query.types } });
    if (query.userId) and.push({ userId: query.userId });
    if (query.from || query.to) and.push({ createdAt: await this.dayRange(query, timezone) });

    const where: Prisma.InventoryMovementWhereInput = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
        include: {
          variant: { include: { product: { select: { name: true } } } },
          fromRack: { select: { locationCode: true } },
          toRack: { select: { locationCode: true } },
          user: { select: { id: true, fullName: true } },
        },
      }),
    ]);
    const items = rows.map(({ variant, fromRack, toRack, user, ...movement }): MovementRowDto => ({
      ...movement,
      createdAt: movement.createdAt.toISOString(),
      sku: variant.sku,
      productName: variant.product.name,
      variantLabel: variantLabel(variant),
      fromLocationCode: fromRack?.locationCode ?? null,
      toLocationCode: toRack?.locationCode ?? null,
      user,
    }));
    return { ...buildPage(items, total, query), timezone };
  }

  /** Rack del código en la sucursal; `undefined` sin código y `null` si no existe. */
  private async rackIdOf(code: string | undefined, branchId: string) {
    if (!code) return undefined;
    const parsed = parseLocationCode(code);
    if (!parsed) return null;
    const rack = await this.prisma.rack.findFirst({
      where: { locationCode: parsed.code, warehouse: { branchId } },
      select: { id: true },
    });
    return rack?.id ?? null;
  }

  /** `[inicio de from, inicio del día siguiente a to)` en la zona horaria de la sucursal. */
  private async dayRange(query: MovementListQuery, timezone: string) {
    const range: { gte?: Date; lt?: Date } = {};
    if (query.from) range.gte = await this.localMidnight(query.from, timezone, 0);
    if (query.to) range.lt = await this.localMidnight(query.to, timezone, 1);
    return range;
  }

  private async localMidnight(date: string, timezone: string, plusDays: number): Promise<Date> {
    const [row] = await this.prisma.$queryRaw<{ at: Date }[]>`
      SELECT ((${date}::date + ${plusDays}::int)::timestamp AT TIME ZONE ${timezone}) AS at`;
    return row!.at;
  }
}
