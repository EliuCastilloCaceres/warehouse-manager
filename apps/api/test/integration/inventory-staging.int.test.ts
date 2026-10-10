import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('staging (T34)', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();

  beforeAll(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
    await prisma.$transaction(async (tx) => {
      await inventory.receive(tx, {
        type: 'INITIAL_LOAD',
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 4,
        userId: f.userId,
      });
      await inventory.pick(tx, {
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 3,
        userId: f.userId,
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('moveReservedToStaging mueve unidades reservadas a STG-01-01 del mismo almacén', async () => {
    const res = await prisma.$transaction((tx) =>
      inventory.moveReservedToStaging(tx, {
        variantId: f.variantId,
        fromRackId: f.rackA,
        quantity: 2,
        userId: f.userId,
      }),
    );
    expect(res.movement).toMatchObject({
      type: 'TO_STAGING',
      fromRackId: f.rackA,
      toRackId: f.stagingRackId,
    });
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 2, reservedQty: 1 });
    expect(await stockOf(prisma, f.variantId, f.stagingRackId)).toEqual({
      quantity: 2,
      reservedQty: 0,
    });
    await expect(
      prisma.$transaction((tx) =>
        inventory.moveReservedToStaging(tx, {
          variantId: f.variantId,
          fromRackId: f.rackA,
          quantity: 2,
          userId: f.userId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_OPERATION' });
  });

  it('returnCancelledSaleToStaging suma en staging con SALE_CANCEL', async () => {
    const res = await prisma.$transaction((tx) =>
      inventory.returnCancelledSaleToStaging(tx, {
        variantId: f.variantId,
        warehouseId: f.warehouseId,
        quantity: 1,
        userId: f.userId,
        reference: { type: 'SALE', id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' },
      }),
    );
    expect(res.movement).toMatchObject({ type: 'SALE_CANCEL', toRackId: f.stagingRackId });
    expect((await stockOf(prisma, f.variantId, f.stagingRackId)).quantity).toBe(3);
  });

  it('un almacén sin staging activo → INVENTORY_INVALID_OPERATION', async () => {
    const otherStaging = await prisma.rack.findFirstOrThrow({
      where: { warehouseId: f.otherWarehouseId, locationCode: 'STG-01-01' },
    });
    await prisma.rack.update({ where: { id: otherStaging.id }, data: { isActive: false } });
    await expect(
      prisma.$transaction((tx) =>
        inventory.returnCancelledSaleToStaging(tx, {
          variantId: f.variantId,
          warehouseId: f.otherWarehouseId,
          quantity: 1,
          userId: f.userId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_OPERATION' });
  });
});
