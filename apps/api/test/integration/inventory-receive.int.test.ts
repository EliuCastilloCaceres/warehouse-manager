import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('receive (T30)', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();

  beforeAll(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const receive = (input: Partial<Parameters<InventoryService['receive']>[1]>) =>
    prisma.$transaction((tx) =>
      inventory.receive(tx, {
        type: 'PUTAWAY',
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 1,
        userId: f.userId,
        ...input,
      }),
    );

  it('INITIAL_LOAD crea el stock y su movimiento; un PUTAWAY acumula', async () => {
    const first = await receive({ type: 'INITIAL_LOAD', quantity: 3 });
    expect(first.movement).toMatchObject({
      type: 'INITIAL_LOAD',
      fromRackId: null,
      toRackId: f.rackA,
      quantity: 3,
      userId: f.userId,
    });
    expect(first.balances).toEqual([{ rackId: f.rackA, quantity: 3, reservedQty: 0 }]);

    const second = await receive({ type: 'PUTAWAY', quantity: 2 });
    expect(second.balances).toEqual([{ rackId: f.rackA, quantity: 5, reservedQty: 0 }]);
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 5, reservedQty: 0 });
    expect(await prisma.inventoryMovement.count({ where: { toRackId: f.rackA } })).toBe(2);
  });

  it('staging ignora la capacidad', async () => {
    const res = await receive({ rackId: f.stagingRackId, quantity: 500 });
    expect(res.movement.capacityOverridden).toBe(false);
    expect(res.balances[0]!.quantity).toBe(500);
  });

  it('rack inactivo → RACK_INACTIVE; variante inexistente → NOT_FOUND', async () => {
    await expect(receive({ rackId: f.inactiveRack })).rejects.toMatchObject({
      code: 'RACK_INACTIVE',
    });
    await expect(
      receive({ variantId: '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ADJUSTMENT_IN exige nota y motivo; con ambos guarda el motivo', async () => {
    await expect(
      receive({ type: 'ADJUSTMENT_IN', adjustmentReason: 'FOUND' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'note' }] });
    await expect(
      receive({ type: 'ADJUSTMENT_IN', note: 'Apareció en bodega' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'adjustmentReason' }] });
    await expect(receive({ adjustmentReason: 'FOUND' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'adjustmentReason' }],
    });

    const ok = await receive({
      type: 'ADJUSTMENT_IN',
      rackId: f.rackB,
      note: 'Apareció en bodega',
      adjustmentReason: 'FOUND',
    });
    expect(ok.movement).toMatchObject({ adjustmentReason: 'FOUND', note: 'Apareció en bodega' });
  });

  it('cantidad no positiva → VALIDATION_ERROR', async () => {
    await expect(receive({ quantity: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'quantity' }],
    });
  });
});
