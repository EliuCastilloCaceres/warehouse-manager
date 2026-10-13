import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { InventoryService } from '../../../src/modules/inventory/inventory.service.js';

/** Payload de `POST /products` para un producto variable (tallas × Negro). */
export function variableInput(sku: string, sizes = ['25', '26'], overrides: object = {}) {
  return {
    sku,
    name: `Producto ${sku}`,
    type: 'VARIABLE',
    price: 89900,
    variants: sizes.map((size) => ({ sku: `${sku}-${size}`, size, color: 'Negro' })),
    ...overrides,
  };
}

export function simpleInput(sku: string, overrides: object = {}) {
  return { sku, name: `Producto ${sku}`, type: 'SIMPLE', price: 34900, ...overrides };
}

export interface ReceiveOptions {
  userId: string;
  quantity: number;
  /** Sucursal (por defecto `S1`) y rack (por defecto su staging `STG-01-01`). */
  branch?: string;
  location?: string;
  type?: 'INITIAL_LOAD' | 'PUTAWAY';
}

/** Entrada de stock con el núcleo de inventario: deja historial en la variante. */
export async function receiveStock(
  prisma: PrismaClient,
  variantId: string,
  {
    userId,
    quantity,
    branch = 'S1',
    location = 'STG-01-01',
    type = 'INITIAL_LOAD',
  }: ReceiveOptions,
) {
  const rack = await prisma.rack.findFirstOrThrow({
    where: { locationCode: location, warehouse: { branch: { code: branch } } },
  });
  const inventory = new InventoryService();
  return prisma.$transaction((tx) =>
    inventory.receive(tx, { type, variantId, rackId: rack.id, quantity, userId }),
  );
}

/** Imagen de producto en la BD (sin archivo): `/uploads/product/<uuid>.webp` y su miniatura. */
export function imageUrls(n: number) {
  const uuid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { url: `/uploads/product/${uuid}.webp`, thumbUrl: `/uploads/product/${uuid}.thumb.webp` };
}
