import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory } from './helpers/inventory.js';

describe('atomicidad (T36)', () => {
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

  it('un receive dentro de un tx que luego falla no deja stock ni movimiento', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await inventory.receive(tx, {
          type: 'PUTAWAY',
          variantId: f.variantId,
          rackId: f.rackA,
          quantity: 4,
          userId: f.userId,
        });
        throw new Error('falla después del receive');
      }),
    ).rejects.toThrow('falla después del receive');

    expect(await prisma.stockLocation.count()).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);
  });
});
