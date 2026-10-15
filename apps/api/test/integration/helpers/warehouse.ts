import type { FastifyInstance, InjectOptions } from 'fastify';
import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { InventoryService } from '../../../src/modules/inventory/inventory.service.js';
import { bearer } from './auth.js';

/** Almacén `ALM1` de la sucursal y su staging `STG-01-01` (seed base). */
export async function warehouseOf(prisma: PrismaClient, branch = 'S1') {
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { code: 'ALM1', branch: { code: branch } },
  });
  const stagingRack = await prisma.rack.findFirstOrThrow({
    where: { warehouseId: warehouse.id, locationCode: 'STG-01-01' },
    include: { container: true },
  });
  return {
    id: warehouse.id,
    branchId: warehouse.branchId,
    staging: {
      zoneId: stagingRack.container.zoneId,
      containerId: stagingRack.containerId,
      rackId: stagingRack.id,
    },
  };
}

/** Cliente de la API con el token (y la sucursal, si se indica) ya puestos. */
export function apiAs(app: FastifyInstance, token: string, branchId?: string) {
  const headers = { ...bearer(token), ...(branchId ? { 'x-branch-id': branchId } : {}) };
  const send = (method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload ? { payload: payload as Record<string, unknown> } : {}),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, payload?: object) => send('POST', url, payload ?? {}),
    patch: (url: string, payload: object) => send('PATCH', url, payload),
    delete: (url: string) => send('DELETE', url),
  };
}
export type Api = ReturnType<typeof apiAs>;

/** Zona → contenedor → racks creados directo en la BD (con sus `locationCode`). */
export async function createStructure(
  prisma: PrismaClient,
  warehouseId: string,
  {
    zone,
    containers = ['01'],
    racks = ['01'],
    capacity = 40,
    color = null,
    priority = 0,
    sortOrder = 0,
  }: {
    zone: string;
    containers?: string[];
    racks?: string[];
    capacity?: number;
    color?: string | null;
    priority?: number;
    sortOrder?: number;
  },
) {
  const zoneRow = await prisma.zone.create({
    data: { warehouseId, code: zone, name: `Zona ${zone}`, color, priority, sortOrder },
  });
  const rackIds: Record<string, string> = {};
  const containerIds: Record<string, string> = {};
  for (const containerCode of containers) {
    const container = await prisma.container.create({
      data: { zoneId: zoneRow.id, code: containerCode },
    });
    containerIds[containerCode] = container.id;
    for (const rackCode of racks) {
      const locationCode = `${zone}-${containerCode}-${rackCode}`;
      const rack = await prisma.rack.create({
        data: {
          containerId: container.id,
          warehouseId,
          code: rackCode,
          locationCode,
          capacityUnits: capacity,
        },
      });
      rackIds[locationCode] = rack.id;
    }
  }
  return { zoneId: zoneRow.id, containerIds, rackIds };
}

/** Producto variable con una variante por color (talla 25). */
export async function createProduct(prisma: PrismaClient, sku: string, colors = ['NEG']) {
  const product = await prisma.product.create({
    data: { sku, name: `Producto ${sku}`, type: 'VARIABLE', price: 50000 },
  });
  const variants = [];
  for (const color of colors) {
    variants.push(
      await prisma.productVariant.create({
        data: { productId: product.id, sku: `${sku}-25-${color}`, size: '25', color },
      }),
    );
  }
  return { productId: product.id, variantIds: variants.map((v) => v.id) };
}

/** Entrada de stock con el núcleo de inventario (ignora la capacidad). */
export async function putStock(
  prisma: PrismaClient,
  input: { variantId: string; rackId: string; quantity: number; userId: string; reserve?: number },
) {
  const inventory = new InventoryService();
  await prisma.$transaction(async (tx) => {
    await inventory.receive(tx, {
      type: 'PUTAWAY',
      variantId: input.variantId,
      rackId: input.rackId,
      quantity: input.quantity,
      userId: input.userId,
      overrideCapacity: true,
    });
    if (input.reserve) {
      await inventory.pick(tx, {
        variantId: input.variantId,
        rackId: input.rackId,
        quantity: input.reserve,
        userId: input.userId,
      });
    }
  });
}
