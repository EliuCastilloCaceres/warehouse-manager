import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { resetWithSeed } from './seed.js';

/** Escenario de inventario sobre el seed base (S1 y S2 con su staging STG-01-01). */
export interface InventoryFixture {
  userId: string;
  warehouseId: string;
  otherWarehouseId: string;
  stagingRackId: string;
  /** Zona A de S1: racks A-01-01..A-01-03 (capacidad 10; A-01-03 inactivo). */
  rackA: string;
  rackB: string;
  inactiveRack: string;
  /** Rack A-01-01 del almacén de S2. */
  otherWarehouseRack: string;
  variantId: string;
  otherVariantId: string;
}

async function rack(
  prisma: PrismaClient,
  containerId: string,
  warehouseId: string,
  code: string,
  { capacity = 10, isActive = true } = {},
) {
  return prisma.rack.create({
    data: {
      containerId,
      warehouseId,
      code,
      locationCode: `A-01-${code}`,
      capacityUnits: capacity,
      isActive,
    },
  });
}

export async function setupInventory(prisma: PrismaClient): Promise<InventoryFixture> {
  await resetWithSeed(prisma);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const [w1, w2] = await Promise.all(
    ['S1', 'S2'].map((code) =>
      prisma.warehouse.findFirstOrThrow({ where: { code: 'ALM1', branch: { code } } }),
    ),
  );
  const staging = await prisma.rack.findFirstOrThrow({
    where: { warehouseId: w1!.id, locationCode: 'STG-01-01' },
  });

  const zone1 = await prisma.zone.create({
    data: { warehouseId: w1!.id, code: 'A', name: 'Zona A' },
  });
  const c1 = await prisma.container.create({ data: { zoneId: zone1.id, code: '01' } });
  const zone2 = await prisma.zone.create({
    data: { warehouseId: w2!.id, code: 'A', name: 'Zona A' },
  });
  const c2 = await prisma.container.create({ data: { zoneId: zone2.id, code: '01' } });

  const product = await prisma.product.create({
    data: { sku: 'INV0001', name: 'Producto de inventario', type: 'VARIABLE', price: 10000 },
  });
  const [v1, v2] = await Promise.all(
    ['NEG', 'CAF'].map((color) =>
      prisma.productVariant.create({
        data: { productId: product.id, sku: `INV0001-25-${color}`, size: '25', color },
      }),
    ),
  );

  return {
    userId: admin.id,
    warehouseId: w1!.id,
    otherWarehouseId: w2!.id,
    stagingRackId: staging.id,
    rackA: (await rack(prisma, c1.id, w1!.id, '01')).id,
    rackB: (await rack(prisma, c1.id, w1!.id, '02')).id,
    inactiveRack: (await rack(prisma, c1.id, w1!.id, '03', { isActive: false })).id,
    otherWarehouseRack: (await rack(prisma, c2.id, w2!.id, '01')).id,
    variantId: v1!.id,
    otherVariantId: v2!.id,
  };
}

export async function stockOf(prisma: PrismaClient, variantId: string, rackId: string) {
  const row = await prisma.stockLocation.findUnique({
    where: { variantId_rackId: { variantId, rackId } },
  });
  return { quantity: row?.quantity ?? 0, reservedQty: row?.reservedQty ?? 0 };
}
