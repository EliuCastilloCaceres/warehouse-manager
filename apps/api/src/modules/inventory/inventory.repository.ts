import type { Prisma } from '../../generated/prisma/client.js';

// SQL crudo del núcleo de inventario: bloqueos de rack, UPDATE condicionales y upserts.
// Todas las funciones reciben el `tx` del llamador.

type Tx = Prisma.TransactionClient;

export interface RackRow {
  id: string;
  warehouseId: string;
  locationCode: string;
  capacityUnits: number;
  isActive: boolean;
  isStaging: boolean;
}

interface BalanceRow {
  quantity: number;
  reservedQty: number;
}

/** Bloquea los racks (`FOR UPDATE`) en orden ascendente de id, para evitar deadlocks. */
export function lockRacks(tx: Tx, ids: string[]): Promise<RackRow[]> {
  return tx.$queryRaw<RackRow[]>`
    SELECT r.id, r.warehouse_id AS "warehouseId", r.location_code AS "locationCode",
           r.capacity_units AS "capacityUnits", r.is_active AS "isActive", z.is_staging AS "isStaging"
    FROM rack r
    JOIN container c ON c.id = r.container_id
    JOIN zone z ON z.id = c.zone_id
    WHERE r.id = ANY(${ids}::uuid[])
    ORDER BY r.id
    FOR UPDATE OF r`;
}

/** Rack sin bloquear (operaciones que no dependen de la capacidad). */
export async function findRack(tx: Tx, id: string): Promise<RackRow | null> {
  const rows = await tx.$queryRaw<RackRow[]>`
    SELECT r.id, r.warehouse_id AS "warehouseId", r.location_code AS "locationCode",
           r.capacity_units AS "capacityUnits", r.is_active AS "isActive", z.is_staging AS "isStaging"
    FROM rack r
    JOIN container c ON c.id = r.container_id
    JOIN zone z ON z.id = c.zone_id
    WHERE r.id = ${id}::uuid`;
  return rows[0] ?? null;
}

/** Rack de staging activo del almacén (`STG-01-01`), o `null`. */
export async function findStagingRackId(tx: Tx, warehouseId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id
    FROM rack r
    JOIN container c ON c.id = r.container_id
    JOIN zone z ON z.id = c.zone_id
    WHERE r.warehouse_id = ${warehouseId}::uuid AND z.is_staging AND z.is_active AND r.is_active
    ORDER BY r.location_code
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

export async function variantExists(tx: Tx, variantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM product_variant WHERE id = ${variantId}::uuid) AS "exists"`;
  return rows[0]?.exists ?? false;
}

/** Unidades ocupadas del rack (Σ quantity de todas sus variantes). */
export async function occupiedUnits(tx: Tx, rackId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ occupied: number }[]>`
    SELECT COALESCE(SUM(quantity), 0)::int AS occupied
    FROM stock_location WHERE rack_id = ${rackId}::uuid`;
  return rows[0]?.occupied ?? 0;
}

/** Unidades disponibles (existencia − reservadas) de la variante en el rack. */
export async function availableUnits(tx: Tx, variantId: string, rackId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ available: number }[]>`
    SELECT (quantity - reserved_qty)::int AS available
    FROM stock_location WHERE variant_id = ${variantId}::uuid AND rack_id = ${rackId}::uuid`;
  return rows[0]?.available ?? 0;
}

/** Upsert: `quantity += n` (crea la fila si no existe). */
export async function addQuantity(
  tx: Tx,
  variantId: string,
  rackId: string,
  n: number,
): Promise<BalanceRow> {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    INSERT INTO stock_location (variant_id, rack_id, quantity, reserved_qty, updated_at)
    VALUES (${variantId}::uuid, ${rackId}::uuid, ${n}::int, 0, now())
    ON CONFLICT (variant_id, rack_id)
    DO UPDATE SET quantity = stock_location.quantity + EXCLUDED.quantity, updated_at = now()
    RETURNING quantity, reserved_qty AS "reservedQty"`;
  return rows[0]!;
}

/** `quantity -= n` solo si hay `n` unidades disponibles. `null` si no alcanzan. */
export async function takeAvailable(tx: Tx, variantId: string, rackId: string, n: number) {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    UPDATE stock_location SET quantity = quantity - ${n}::int, updated_at = now()
    WHERE variant_id = ${variantId}::uuid AND rack_id = ${rackId}::uuid
      AND quantity - reserved_qty >= ${n}::int
    RETURNING quantity, reserved_qty AS "reservedQty"`;
  return rows[0] ?? null;
}

/** `reserved_qty += n` solo si hay `n` unidades disponibles. */
export async function reserve(tx: Tx, variantId: string, rackId: string, n: number) {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    UPDATE stock_location SET reserved_qty = reserved_qty + ${n}::int, updated_at = now()
    WHERE variant_id = ${variantId}::uuid AND rack_id = ${rackId}::uuid
      AND quantity - reserved_qty >= ${n}::int
    RETURNING quantity, reserved_qty AS "reservedQty"`;
  return rows[0] ?? null;
}

/** `reserved_qty -= n` solo si hay `n` reservadas. */
export async function unreserve(tx: Tx, variantId: string, rackId: string, n: number) {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    UPDATE stock_location SET reserved_qty = reserved_qty - ${n}::int, updated_at = now()
    WHERE variant_id = ${variantId}::uuid AND rack_id = ${rackId}::uuid
      AND reserved_qty >= ${n}::int
    RETURNING quantity, reserved_qty AS "reservedQty"`;
  return rows[0] ?? null;
}

/** `quantity -= n` y `reserved_qty -= n` solo si hay `n` reservadas (venta o envío a staging). */
export async function consumeReserved(tx: Tx, variantId: string, rackId: string, n: number) {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    UPDATE stock_location
    SET quantity = quantity - ${n}::int, reserved_qty = reserved_qty - ${n}::int, updated_at = now()
    WHERE variant_id = ${variantId}::uuid AND rack_id = ${rackId}::uuid
      AND reserved_qty >= ${n}::int
    RETURNING quantity, reserved_qty AS "reservedQty"`;
  return rows[0] ?? null;
}
