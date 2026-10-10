import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('capacidad (T31)', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();

  beforeAll(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
    await prisma.$transaction((tx) =>
      inventory.receive(tx, {
        type: 'INITIAL_LOAD',
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 8,
        userId: f.userId,
      }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const putaway = (quantity: number, overrideCapacity?: boolean) =>
    prisma.$transaction((tx) =>
      inventory.receive(tx, {
        type: 'PUTAWAY',
        variantId: f.otherVariantId,
        rackId: f.rackA,
        quantity,
        overrideCapacity,
        userId: f.userId,
      }),
    );

  it('exceder la capacidad → RACK_CAPACITY_EXCEEDED con detalles y sin escrituras', async () => {
    const movementsBefore = await prisma.inventoryMovement.count();
    await expect(putaway(3)).rejects.toMatchObject({
      code: 'RACK_CAPACITY_EXCEEDED',
      details: {
        rackId: f.rackA,
        locationCode: 'A-01-01',
        capacity: 10,
        occupied: 8,
        requested: 3,
      },
    });
    expect(await stockOf(prisma, f.otherVariantId, f.rackA)).toEqual({
      quantity: 0,
      reservedQty: 0,
    });
    expect(await prisma.inventoryMovement.count()).toBe(movementsBefore);
  });

  it('justo en el límite → OK', async () => {
    const res = await putaway(2);
    expect(res.movement.capacityOverridden).toBe(false);
  });

  it('con overrideCapacity → OK y capacityOverridden', async () => {
    const res = await putaway(5, true);
    expect(res.movement.capacityOverridden).toBe(true);
    expect(await stockOf(prisma, f.otherVariantId, f.rackA)).toEqual({
      quantity: 7,
      reservedQty: 0,
    });
  });
});
