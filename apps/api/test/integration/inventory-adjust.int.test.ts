import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('adjustOut (T35)', () => {
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
        quantity: 5,
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

  const adjustOut = (input: Partial<Parameters<InventoryService['adjustOut']>[1]>) =>
    prisma.$transaction((tx) =>
      inventory.adjustOut(tx, {
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 1,
        userId: f.userId,
        note: 'Se rompió la caja',
        adjustmentReason: 'DAMAGE',
        ...input,
      }),
    );

  it('exige nota y motivo', async () => {
    await expect(adjustOut({ note: '  ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'note' }],
    });
    await expect(adjustOut({ adjustmentReason: null })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'adjustmentReason' }],
    });
  });

  it('no toma unidades reservadas', async () => {
    await expect(adjustOut({ quantity: 3 })).rejects.toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { available: 2, requested: 3 },
    });
  });

  it('descuenta las disponibles y guarda nota y motivo', async () => {
    const res = await adjustOut({ quantity: 2 });
    expect(res.movement).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      fromRackId: f.rackA,
      note: 'Se rompió la caja',
      adjustmentReason: 'DAMAGE',
    });
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 3, reservedQty: 3 });
  });
});
