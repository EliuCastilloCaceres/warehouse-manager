import type { StockFilter } from '@warehouse-manager/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

// Acceso a datos de la estructura del almacén (zonas, contenedores y racks).

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

const WAREHOUSE_REF = { select: { branchId: true } } as const;

export function findWarehouse(db: Db, id: string) {
  return db.warehouse.findUnique({ where: { id } });
}

export function findZone(db: Db, id: string) {
  return db.zone.findUnique({ where: { id }, include: { warehouse: WAREHOUSE_REF } });
}
export type ZoneRow = NonNullable<Awaited<ReturnType<typeof findZone>>>;

export function findContainer(db: Db, id: string) {
  return db.container.findUnique({
    where: { id },
    include: { zone: { include: { warehouse: WAREHOUSE_REF } } },
  });
}
export type ContainerRow = NonNullable<Awaited<ReturnType<typeof findContainer>>>;

export function findRack(db: Db, id: string) {
  return db.rack.findUnique({
    where: { id },
    include: { container: { include: { zone: { include: { warehouse: WAREHOUSE_REF } } } } },
  });
}
export type RackRow = NonNullable<Awaited<ReturnType<typeof findRack>>>;

/** Subárbol de un nodo, como filtro de racks. */
export type Subtree = { zoneId: string } | { containerId: string } | { rackId: string };

export function rackWhere(subtree: Subtree): Prisma.RackWhereInput {
  if ('rackId' in subtree) return { id: subtree.rackId };
  if ('containerId' in subtree) return { containerId: subtree.containerId };
  return { container: { zoneId: subtree.zoneId } };
}

export function racksOf(db: Db, subtree: Subtree) {
  return db.rack.findMany({
    where: rackWhere(subtree),
    select: { id: true, locationCode: true },
    orderBy: { locationCode: 'asc' },
  });
}

/** Bloquea los racks (`FOR UPDATE`, en orden de id como F2) para que nadie les agregue stock. */
export async function lockRacks(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM rack WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/** `locationCode` de los racks con unidades (Σ quantity > 0). */
export async function stockedLocationCodes(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRaw<{ locationCode: string }[]>`
    SELECT r.location_code AS "locationCode"
    FROM rack r JOIN stock_location s ON s.rack_id = r.id
    WHERE r.id = ANY(${ids}::uuid[])
    GROUP BY r.id, r.location_code
    HAVING SUM(s.quantity) > 0
    ORDER BY r.location_code`;
  return rows.map((r) => r.locationCode);
}

/** ¿Algún rack tiene filas de stock, movimientos, ítems de carrito o de venta? */
export async function anyRackHasHistory(db: Db, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const rows = await db.$queryRaw<{ used: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM stock_location WHERE rack_id = ANY(${ids}::uuid[]))
        OR EXISTS (SELECT 1 FROM inventory_movement
                   WHERE from_rack_id = ANY(${ids}::uuid[]) OR to_rack_id = ANY(${ids}::uuid[]))
        OR EXISTS (SELECT 1 FROM cart_item WHERE source_rack_id = ANY(${ids}::uuid[]))
        OR EXISTS (SELECT 1 FROM sale_item WHERE source_rack_id = ANY(${ids}::uuid[])) AS used`;
  return rows[0]?.used ?? false;
}

/** Recalcula `location_code` de los racks indicados a partir de los códigos de su jerarquía. */
export async function recomputeLocationCodes(
  tx: Tx,
  ids: string[],
): Promise<{ id: string; locationCode: string }[]> {
  if (ids.length === 0) return [];
  return tx.$queryRaw<{ id: string; locationCode: string }[]>`
    UPDATE rack r
    SET location_code = z.code || '-' || c.code || '-' || r.code, updated_at = now()
    FROM container c JOIN zone z ON z.id = c.zone_id
    WHERE c.id = r.container_id AND r.id = ANY(${ids}::uuid[])
    RETURNING r.id, r.location_code AS "locationCode"`;
}

/** Unidades ocupadas del rack (Σ quantity). */
export async function occupiedUnits(db: Db, rackId: string): Promise<number> {
  const result = await db.stockLocation.aggregate({
    where: { rackId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export async function zoneCodes(db: Db, warehouseId: string): Promise<string[]> {
  const rows = await db.zone.findMany({ where: { warehouseId }, select: { code: true } });
  return rows.map((r) => r.code);
}

export async function containerCodes(db: Db, zoneId: string): Promise<string[]> {
  const rows = await db.container.findMany({ where: { zoneId }, select: { code: true } });
  return rows.map((r) => r.code);
}

export async function rackCodes(db: Db, containerId: string): Promise<string[]> {
  const rows = await db.rack.findMany({ where: { containerId }, select: { code: true } });
  return rows.map((r) => r.code);
}

// ─── Ocupación, estados y contenido ──────────────────────────────────────────

export interface RackOccupancyRow {
  rackId: string;
  occupied: number;
  reserved: number;
}

/** Ocupación de cada rack del almacén (vista `v_rack_occupancy`). */
export function rackOccupancy(db: Db, warehouseId: string): Promise<RackOccupancyRow[]> {
  return db.$queryRaw<RackOccupancyRow[]>`
    SELECT rack_id AS "rackId", occupied_units AS occupied, reserved_units AS reserved
    FROM v_rack_occupancy WHERE warehouse_id = ${warehouseId}::uuid`;
}

/**
 * Existencia por variante en todos los almacenes de la sucursal: total, reservadas y en
 * staging. Es la base del estado de la variante (`variantStockStatus`).
 */
export function branchStockCte(branchId: string): Prisma.Sql {
  return Prisma.sql`branch_stock AS (
    SELECT s.variant_id,
           SUM(s.quantity)::int AS quantity,
           SUM(s.reserved_qty)::int AS reserved,
           SUM(CASE WHEN z.is_staging THEN s.quantity ELSE 0 END)::int AS staging
    FROM stock_location s
    JOIN rack r ON r.id = s.rack_id
    JOIN container c ON c.id = r.container_id
    JOIN zone z ON z.id = c.zone_id
    JOIN warehouse w ON w.id = r.warehouse_id
    WHERE w.branch_id = ${branchId}::uuid
    GROUP BY s.variant_id
  )`;
}

/**
 * Filtro de filas por estado (spec F7 §3), con `b` = `branch_stock`. Sin estado, solo filas con
 * unidades; `AGOTADO` es el único que muestra filas con `quantity` 0.
 */
export function stockFilterSql(
  status: StockFilter | undefined,
  threshold: number,
  row: { quantity: Prisma.Sql; reserved: Prisma.Sql },
): Prisma.Sql {
  switch (status) {
    case 'AGOTADO':
      return Prisma.sql`b.quantity = 0`;
    case 'BAJO':
      return Prisma.sql`${row.quantity} > 0 AND b.quantity - b.reserved <= ${threshold}`;
    case 'EN_PISO':
      return Prisma.sql`${row.reserved} > 0`;
    case 'EN_STAGING':
      return Prisma.sql`${row.quantity} > 0 AND b.staging > 0`;
    default:
      return Prisma.sql`${row.quantity} > 0`;
  }
}

export interface MatchCountRow {
  zoneId: string;
  containerId: string | null;
  rackId: string | null;
  count: number;
}

/** Variantes que coinciden con el estado, por zona, contenedor y rack del almacén. */
export function matchCounts(
  db: Db,
  warehouseId: string,
  branchId: string,
  status: StockFilter,
  threshold: number,
): Promise<MatchCountRow[]> {
  const filter = stockFilterSql(status, threshold, {
    quantity: Prisma.sql`s.quantity`,
    reserved: Prisma.sql`s.reserved_qty`,
  });
  return db.$queryRaw<MatchCountRow[]>`
    WITH ${branchStockCte(branchId)}
    SELECT c.zone_id AS "zoneId", r.container_id AS "containerId", r.id AS "rackId",
           COUNT(DISTINCT s.variant_id)::int AS count
    FROM stock_location s
    JOIN branch_stock b ON b.variant_id = s.variant_id
    JOIN rack r ON r.id = s.rack_id
    JOIN container c ON c.id = r.container_id
    WHERE r.warehouse_id = ${warehouseId}::uuid AND ${filter}
    GROUP BY GROUPING SETS ((c.zone_id), (c.zone_id, r.container_id),
                            (c.zone_id, r.container_id, r.id))`;
}

export interface ContentRow {
  variantId: string;
  sku: string;
  productName: string;
  size: string | null;
  color: string | null;
  material: string | null;
  thumbUrl: string | null;
  quantity: number;
  reservedQty: number;
  branchQuantity: number;
  branchReserved: number;
  branchStaging: number;
}

/** Contenido de un subárbol agregado por variante, filtrado y paginado (orden por SKU). */
export async function nodeContent(
  db: Db,
  subtree: Subtree,
  branchId: string,
  options: {
    status?: StockFilter;
    threshold: number;
    q?: string;
    skip: number;
    take: number;
  },
): Promise<{ rows: ContentRow[]; total: number }> {
  const node =
    'rackId' in subtree
      ? Prisma.sql`r.id = ${subtree.rackId}::uuid`
      : 'containerId' in subtree
        ? Prisma.sql`r.container_id = ${subtree.containerId}::uuid`
        : Prisma.sql`c.zone_id = ${subtree.zoneId}::uuid`;
  const filter = stockFilterSql(options.status, options.threshold, {
    quantity: Prisma.sql`n.quantity`,
    reserved: Prisma.sql`n.reserved`,
  });
  const search = options.q
    ? Prisma.sql`AND (v.sku ILIKE ${likePattern(options.q)} OR p.name ILIKE ${likePattern(options.q)})`
    : Prisma.empty;
  const query = (columns: Prisma.Sql, tail: Prisma.Sql = Prisma.empty) => Prisma.sql`
    WITH ${branchStockCte(branchId)},
    node AS (
      SELECT s.variant_id, SUM(s.quantity)::int AS quantity, SUM(s.reserved_qty)::int AS reserved
      FROM stock_location s
      JOIN rack r ON r.id = s.rack_id
      JOIN container c ON c.id = r.container_id
      WHERE ${node}
      GROUP BY s.variant_id
    )
    SELECT ${columns}
    FROM node n
    JOIN branch_stock b ON b.variant_id = n.variant_id
    JOIN product_variant v ON v.id = n.variant_id
    JOIN product p ON p.id = v.product_id
    WHERE ${filter} ${search}
    ${tail}`;
  const [count] = await db.$queryRaw<{ total: number }[]>(
    query(Prisma.sql`COUNT(*)::int AS total`),
  );
  const rows = await db.$queryRaw<ContentRow[]>(
    query(
      Prisma.sql`n.variant_id AS "variantId", v.sku, p.name AS "productName",
        v.size, v.color, v.material,
        (SELECT i.thumb_url FROM product_image i WHERE i.product_id = v.product_id
         ORDER BY (i.variant_id = v.id) IS TRUE DESC, i.sort_order, i.created_at
         LIMIT 1) AS "thumbUrl",
        n.quantity, n.reserved AS "reservedQty", b.quantity AS "branchQuantity",
        b.reserved AS "branchReserved", b.staging AS "branchStaging"`,
      Prisma.sql`ORDER BY v.sku LIMIT ${options.take} OFFSET ${options.skip}`,
    ),
  );
  return { rows, total: count?.total ?? 0 };
}

/** `%texto%` escapando los comodines de `LIKE`. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Capacidad y ocupación sumadas de un subárbol (solo racks activos si se pide). */
export function subtreeOccupancy(
  db: Db,
  subtree: Subtree,
  activeOnly: boolean,
): Promise<{ capacity: number; occupied: number; reserved: number }[]> {
  const node =
    'rackId' in subtree
      ? Prisma.sql`rack_id = ${subtree.rackId}::uuid`
      : 'containerId' in subtree
        ? Prisma.sql`container_id = ${subtree.containerId}::uuid`
        : Prisma.sql`zone_id = ${subtree.zoneId}::uuid`;
  return db.$queryRaw`
    SELECT COALESCE(SUM(capacity_units), 0)::int AS capacity,
           COALESCE(SUM(occupied_units), 0)::int AS occupied,
           COALESCE(SUM(reserved_units), 0)::int AS reserved
    FROM v_rack_occupancy
    WHERE ${node} ${activeOnly ? Prisma.sql`AND is_active` : Prisma.empty}`;
}
