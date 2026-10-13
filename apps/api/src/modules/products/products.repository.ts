import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Referencias que dan historial a una variante (spec F6 §2). */
export const HISTORY_COUNT = {
  _count: { select: { inventoryMovements: true, cartItems: true, saleItems: true } },
} as const;

export const PRODUCT_INCLUDE = {
  category: { select: { id: true } },
  brand: { select: { id: true, name: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  // Por SKU: agrupa la matriz por talla y color.
  variants: { orderBy: { sku: 'asc' }, include: HISTORY_COUNT },
} satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
export type VariantRow = ProductRow['variants'][number];

const LIST_INCLUDE = {
  category: { select: { id: true } },
  brand: { select: { id: true, name: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductInclude;

export type ProductListRow = Prisma.ProductGetPayload<{ include: typeof LIST_INCLUDE }>;

export function findProduct(db: Db, id: string): Promise<ProductRow | null> {
  return db.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
}

export async function listProducts(
  db: PrismaClient,
  where: Prisma.ProductWhereInput,
  orderBy: Prisma.ProductOrderByWithRelationInput[],
  page: { skip: number; take: number },
): Promise<[number, ProductListRow[]]> {
  return db.$transaction([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy, ...page, include: LIST_INCLUDE }),
  ]);
}

/** Existencia y reservas por variante en los almacenes de la sucursal. */
export async function stockByVariant(
  db: Db,
  variantIds: readonly string[],
  branchId: string,
): Promise<Map<string, { quantity: number; reservedQty: number }>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db.stockLocation.groupBy({
    by: ['variantId'],
    where: { variantId: { in: [...variantIds] }, rack: { warehouse: { branchId } } },
    _sum: { quantity: true, reservedQty: true },
  });
  return new Map(
    rows.map((row) => [
      row.variantId,
      { quantity: row._sum.quantity ?? 0, reservedQty: row._sum.reservedQty ?? 0 },
    ]),
  );
}

/** Existencia total por producto en la sucursal. */
export async function stockByProduct(
  db: Db,
  productIds: readonly string[],
  branchId: string,
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const variants = await db.productVariant.findMany({
    where: { productId: { in: [...productIds] } },
    select: { id: true, productId: true },
  });
  const stock = await stockByVariant(
    db,
    variants.map((v) => v.id),
    branchId,
  );
  const totals = new Map<string, number>();
  for (const variant of variants) {
    const quantity = stock.get(variant.id)?.quantity ?? 0;
    totals.set(variant.productId, (totals.get(variant.productId) ?? 0) + quantity);
  }
  return totals;
}

export interface SkuCandidate {
  sku: string;
  field: string;
}

/**
 * Primer SKU ya usado por **otro** producto, como SKU padre o de variante (unicidad global,
 * plan §4.2), o primer código de barras de una variante de otro producto.
 */
export async function findSkuConflict(
  db: Db,
  skus: readonly SkuCandidate[],
  barcodes: readonly SkuCandidate[],
  ownProductId: string | null,
): Promise<SkuCandidate | null> {
  const values = skus.map((c) => c.sku);
  const notOwn = ownProductId ? { not: ownProductId } : undefined;
  const [products, variants] = await Promise.all([
    db.product.findMany({
      where: { sku: { in: values }, id: notOwn },
      select: { sku: true },
    }),
    db.productVariant.findMany({
      where: { sku: { in: values }, productId: notOwn },
      select: { sku: true },
    }),
  ]);
  const taken = new Set([...products, ...variants].map((row) => row.sku));
  const sku = skus.find((c) => taken.has(c.sku));
  if (sku) return sku;
  if (barcodes.length === 0) return null;
  const usedBarcodes = await db.productVariant.findMany({
    where: { barcode: { in: barcodes.map((c) => c.sku) }, productId: notOwn },
    select: { barcode: true },
  });
  const takenBarcodes = new Set(usedBarcodes.map((row) => row.barcode));
  return barcodes.find((c) => takenBarcodes.has(c.sku)) ?? null;
}

export function hasHistory(variant: { _count: VariantRow['_count'] }): boolean {
  const { inventoryMovements, cartItems, saleItems } = variant._count;
  return inventoryMovements + cartItems + saleItems > 0;
}
