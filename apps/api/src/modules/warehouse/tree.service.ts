import {
  type ContentNodeDto,
  type ContentQuery,
  type ContentRowDto,
  type NodeContentDto,
  type OccupancyDto,
  occupancyLevel,
  type RackNodeDto,
  variantLabel,
  variantStockStatus,
  type WarehouseTreeDto,
  type WarehouseTreeQuery,
  type ZoneNodeDto,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import { buildPage, toPrismaPage } from '../../core/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  type StructureKind,
  StructureService,
  toContainerDto,
  toRackDto,
  toWarehouseDto,
  toZoneDto,
  type WarehouseActor,
} from './structure.service.js';
import * as repo from './warehouse.repository.js';
import type { ContentRow, MatchCountRow, Subtree } from './warehouse.repository.js';

type Db = Prisma.TransactionClient;

interface Units {
  capacity: number;
  occupied: number;
  reserved: number;
}

/** Ocupación con su porcentaje (un decimal) y nivel; staging no tiene límite. */
export function occupancyOf(
  { capacity, occupied, reserved }: Units,
  unlimited = false,
): OccupancyDto {
  if (unlimited) return { capacity: 0, occupied, reserved, free: 0, pct: null, level: 'none' };
  return {
    capacity,
    occupied,
    reserved,
    free: capacity - occupied,
    pct: capacity > 0 ? Math.round((occupied * 1000) / capacity) / 10 : null,
    level: occupancyLevel(occupied, capacity),
  };
}

const sum = (items: Units[]): Units =>
  items.reduce(
    (acc, u) => ({
      capacity: acc.capacity + u.capacity,
      occupied: acc.occupied + u.occupied,
      reserved: acc.reserved + u.reserved,
    }),
    { capacity: 0, occupied: 0, reserved: 0 },
  );

export function toContentRow(row: ContentRow, threshold: number): ContentRowDto {
  return {
    variantId: row.variantId,
    sku: row.sku,
    productName: row.productName,
    variantLabel: variantLabel(row),
    thumbUrl: row.thumbUrl,
    quantity: row.quantity,
    reservedQty: row.reservedQty,
    available: row.quantity - row.reservedQty,
    stock: variantStockStatus(
      {
        quantity: row.branchQuantity,
        reservedQty: row.branchReserved,
        stagingQuantity: row.branchStaging,
      },
      threshold,
    ),
  };
}

/** Coincidencias por nodo: zona (`z:`), contenedor (`c:`) y rack (`r:`). */
function matchIndex(rows: MatchCountRow[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = row.rackId
      ? `r:${row.rackId}`
      : row.containerId
        ? `c:${row.containerId}`
        : `z:${row.zoneId}`;
    index.set(key, row.count);
  }
  return index;
}

/** Mapa del almacén y contenido de cada nodo (spec F7 §3). */
export class TreeService {
  private readonly structure: StructureService;

  constructor(private readonly app: FastifyInstance) {
    this.structure = new StructureService(app);
  }

  private get prisma() {
    return this.app.prisma;
  }

  private async threshold(branchId: string, db: Db = this.prisma): Promise<number> {
    const branch = await db.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { lowStockThreshold: true },
    });
    return branch.lowStockThreshold;
  }

  async tree(
    actor: WarehouseActor,
    warehouseId: string,
    query: WarehouseTreeQuery,
  ): Promise<WarehouseTreeDto> {
    const warehouse = await this.structure.loadWarehouse(actor, warehouseId);
    const [zones, occupancyRows, matches] = await Promise.all([
      this.prisma.zone.findMany({
        where: { warehouseId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: {
          containers: {
            orderBy: { code: 'asc' },
            include: { racks: { orderBy: { code: 'asc' } } },
          },
        },
      }),
      repo.rackOccupancy(this.prisma, warehouseId),
      query.status
        ? this.threshold(warehouse.branchId).then((threshold) =>
            repo.matchCounts(
              this.prisma,
              warehouseId,
              warehouse.branchId,
              query.status!,
              threshold,
            ),
          )
        : Promise.resolve(null),
    ]);
    const occupancy = new Map(occupancyRows.map((r) => [r.rackId, r]));
    const index = matches ? matchIndex(matches) : null;
    const matchOf = (key: string) => (index ? { matchCount: index.get(key) ?? 0 } : {});
    const visible = (node: { isActive: boolean }) => query.includeInactive || node.isActive;
    const unitsOf = (rack: { id: string; capacityUnits: number }): Units => ({
      capacity: rack.capacityUnits,
      occupied: occupancy.get(rack.id)?.occupied ?? 0,
      reserved: occupancy.get(rack.id)?.reserved ?? 0,
    });

    const stagingZone = zones.find((z) => z.isStaging);
    const stagingRack = stagingZone?.containers[0]?.racks[0];
    if (!stagingRack) {
      throw new DomainError('INTERNAL_ERROR', { message: 'El almacén no tiene staging.' });
    }

    const zoneNodes: ZoneNodeDto[] = [];
    const activeUnits: Units[] = [];
    for (const zone of zones) {
      if (zone.isStaging) continue;
      const zoneUnits: Units[] = [];
      const containers = zone.containers.map((container) => {
        // Totales: solo racks activos (plan §4.3); un rack inactivo se muestra con su ocupación.
        const containerUnits = container.racks.filter((r) => r.isActive).map(unitsOf);
        zoneUnits.push(...containerUnits);
        const racks: RackNodeDto[] = container.racks.filter(visible).map((rack) => ({
          ...toRackDto(rack),
          occupancy: occupancyOf(unitsOf(rack)),
          colorHex: rack.labelColor ?? zone.color,
          ...matchOf(`r:${rack.id}`),
        }));
        return {
          node: {
            ...toContainerDto(container),
            occupancy: occupancyOf(sum(containerUnits)),
            racks,
            ...matchOf(`c:${container.id}`),
          },
          visible: visible(container),
        };
      });
      activeUnits.push(...zoneUnits);
      if (!visible(zone)) continue;
      zoneNodes.push({
        ...toZoneDto(zone),
        occupancy: occupancyOf(sum(zoneUnits)),
        containers: containers.filter((c) => c.visible).map((c) => c.node),
        ...matchOf(`z:${zone.id}`),
      });
    }

    const staging = unitsOf(stagingRack);
    return {
      warehouse: toWarehouseDto(warehouse),
      totals: occupancyOf(sum(activeUnits)),
      staging: {
        rackId: stagingRack.id,
        locationCode: stagingRack.locationCode,
        occupied: staging.occupied,
        reserved: staging.reserved,
        ...matchOf(`r:${stagingRack.id}`),
      },
      zones: zoneNodes,
    };
  }

  /** Contenido de una zona, un contenedor o un rack, agregado por variante. */
  async content(
    actor: WarehouseActor,
    kind: StructureKind,
    id: string,
    query: ContentQuery,
  ): Promise<NodeContentDto> {
    const { node, subtree, branchId } = await this.nodeOf(actor, kind, id);
    return this.contentOf(node, subtree, branchId, query);
  }

  /** Contenido de un rack ya resuelto (búsqueda por código de ubicación). */
  async rackContent(
    rackId: string,
    branchId: string,
    query: ContentQuery,
  ): Promise<NodeContentDto> {
    const { node, subtree } = await this.nodeOf(
      { userId: '', branchIds: [branchId], ip: null },
      'rack',
      rackId,
    );
    return this.contentOf(node, subtree, branchId, query);
  }

  private async contentOf(
    node: ContentNodeDto,
    subtree: Subtree,
    branchId: string,
    query: ContentQuery,
  ): Promise<NodeContentDto> {
    const threshold = await this.threshold(branchId);
    const { rows, total } = await repo.nodeContent(this.prisma, subtree, branchId, {
      status: query.status,
      threshold,
      q: query.q,
      ...toPrismaPage(query),
    });
    return {
      node,
      ...buildPage(
        rows.map((row) => toContentRow(row, threshold)),
        total,
        query,
      ),
    };
  }

  private async nodeOf(
    actor: WarehouseActor,
    kind: StructureKind,
    id: string,
  ): Promise<{ node: ContentNodeDto; subtree: Subtree; branchId: string }> {
    if (kind === 'rack') {
      const rack = await this.structure.loadRack(actor, id);
      const zone = rack.container.zone;
      const [units] = await repo.subtreeOccupancy(this.prisma, { rackId: id }, false);
      return {
        node: {
          kind,
          id,
          code: rack.locationCode,
          name: null,
          isStaging: zone.isStaging,
          isActive: rack.isActive,
          colorHex: rack.labelColor ?? zone.color,
          occupancy: occupancyOf(units!, zone.isStaging),
        },
        subtree: { rackId: id },
        branchId: zone.warehouse.branchId,
      };
    }
    if (kind === 'container') {
      const container = await this.structure.loadContainer(actor, id);
      const zone = container.zone;
      const [units] = await repo.subtreeOccupancy(this.prisma, { containerId: id }, true);
      return {
        node: {
          kind,
          id,
          code: `${zone.code}-${container.code}`,
          name: container.name,
          isStaging: zone.isStaging,
          isActive: container.isActive,
          colorHex: zone.color,
          occupancy: occupancyOf(units!, zone.isStaging),
        },
        subtree: { containerId: id },
        branchId: zone.warehouse.branchId,
      };
    }
    const zone = await this.structure.loadZone(actor, id);
    const [units] = await repo.subtreeOccupancy(this.prisma, { zoneId: id }, true);
    return {
      node: {
        kind,
        id,
        code: zone.code,
        name: zone.name,
        isStaging: zone.isStaging,
        isActive: zone.isActive,
        colorHex: zone.color,
        occupancy: occupancyOf(units!, zone.isStaging),
      },
      subtree: { zoneId: id },
      branchId: zone.warehouse.branchId,
    };
  }
}
