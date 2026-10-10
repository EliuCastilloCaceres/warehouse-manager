import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('relocate (T32)', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();

  beforeAll(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
    await prisma.$transaction(async (t) => {
      await inventory.receive(t, {
        type: 'INITIAL_LOAD',
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 6,
        userId: f.userId,
      });
      // 2 reservadas: quedan 4 disponibles en A.
      await inventory.pick(t, {
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 2,
        userId: f.userId,
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const relocate = (input: Partial<Parameters<InventoryService['relocate']>[1]>) =>
    prisma.$transaction((t) =>
      inventory.relocate(t, {
        variantId: f.variantId,
        fromRackId: f.rackA,
        toRackId: f.rackB,
        quantity: 1,
        userId: f.userId,
        ...input,
      }),
    );

  it('mueve unidades disponibles', async () => {
    const res = await relocate({ quantity: 3 });
    expect(res.movement).toMatchObject({
      type: 'RELOCATE',
      fromRackId: f.rackA,
      toRackId: f.rackB,
    });
    expect(res.balances).toEqual([
      { rackId: f.rackA, quantity: 3, reservedQty: 2 },
      { rackId: f.rackB, quantity: 3, reservedQty: 0 },
    ]);
  });

  it('pedir más que las disponibles (hay reservadas) → STOCK_INSUFFICIENT con available', async () => {
    await expect(relocate({ quantity: 2 })).rejects.toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { available: 1, requested: 2 },
    });
  });

  it('distinto almacén → INVENTORY_CROSS_WAREHOUSE; mismo rack → INVENTORY_INVALID_OPERATION', async () => {
    await expect(relocate({ toRackId: f.otherWarehouseRack })).rejects.toMatchObject({
      code: 'INVENTORY_CROSS_WAREHOUSE',
    });
    await expect(relocate({ toRackId: f.rackA })).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_OPERATION',
    });
  });

  it('destino lleno → RACK_CAPACITY_EXCEEDED', async () => {
    await prisma.$transaction((t) =>
      inventory.receive(t, {
        type: 'PUTAWAY',
        variantId: f.otherVariantId,
        rackId: f.rackB,
        quantity: 7,
        userId: f.userId,
      }),
    );
    await expect(relocate({ quantity: 1 })).rejects.toMatchObject({
      code: 'RACK_CAPACITY_EXCEEDED',
    });
  });

  it('desde un origen inactivo → OK', async () => {
    await prisma.rack.update({ where: { id: f.inactiveRack }, data: { isActive: true } });
    await prisma.$transaction((t) =>
      inventory.receive(t, {
        type: 'PUTAWAY',
        variantId: f.variantId,
        rackId: f.inactiveRack,
        quantity: 2,
        userId: f.userId,
      }),
    );
    await prisma.rack.update({ where: { id: f.inactiveRack }, data: { isActive: false } });

    const res = await relocate({
      fromRackId: f.inactiveRack,
      toRackId: f.stagingRackId,
      quantity: 2,
    });
    expect(res.movement.type).toBe('RELOCATE');
    expect(await stockOf(prisma, f.variantId, f.inactiveRack)).toEqual({
      quantity: 0,
      reservedQty: 0,
    });
  });
});
