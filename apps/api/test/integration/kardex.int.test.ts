import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';
import { createBaseGraph, type BaseGraph } from './helpers/fixtures.js';

describe('kardex inmutable (T19)', () => {
  let prisma: PrismaClient;
  let g: BaseGraph;

  beforeAll(async () => {
    prisma = createTestClient();
    await truncateAll(prisma);
    g = await createBaseGraph(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('INSERT funciona', async () => {
    const movement = await prisma.inventoryMovement.create({
      data: {
        variantId: g.variantId,
        fromRackId: g.rackId,
        quantity: 1,
        type: 'PICK',
        userId: g.userId,
        referenceType: 'CART',
        referenceId: g.cartId,
      },
    });
    expect(movement.id).toBeDefined();
  });

  it('UPDATE falla', async () => {
    await expect(
      prisma.inventoryMovement.update({ where: { id: g.movementId }, data: { note: 'x' } }),
    ).rejects.toThrow('inventory_movement es inmutable');
  });

  it('DELETE falla', async () => {
    await expect(prisma.inventoryMovement.delete({ where: { id: g.movementId } })).rejects.toThrow(
      'inventory_movement es inmutable',
    );
  });
});
