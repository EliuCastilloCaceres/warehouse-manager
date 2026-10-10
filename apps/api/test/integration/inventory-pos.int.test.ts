import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

describe('pick, release y sell (T33)', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();
  const CART = '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c';
  const SALE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  beforeAll(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
    await prisma.$transaction((tx) =>
      inventory.receive(tx, {
        type: 'INITIAL_LOAD',
        variantId: f.variantId,
        rackId: f.rackA,
        quantity: 5,
        userId: f.userId,
      }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const op = (
    method: 'pick' | 'release' | 'sell',
    quantity: number,
    reference: { type: 'CART' | 'SALE'; id: string },
  ) =>
    prisma.$transaction((tx) =>
      inventory[method](tx, {
        variantId: f.variantId,
        rackId: f.rackA,
        quantity,
        userId: f.userId,
        reference,
      }),
    );

  it('pick reserva y lleva la referencia del carrito', async () => {
    const res = await op('pick', 3, { type: 'CART', id: CART });
    expect(res.movement).toMatchObject({
      type: 'PICK',
      fromRackId: f.rackA,
      toRackId: null,
      referenceType: 'CART',
      referenceId: CART,
    });
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 5, reservedQty: 3 });
  });

  it('pick mayor que lo disponible → STOCK_INSUFFICIENT', async () => {
    await expect(op('pick', 3, { type: 'CART', id: CART })).rejects.toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { available: 2, requested: 3 },
    });
  });

  it('release libera; release mayor que lo reservado → INVENTORY_INVALID_OPERATION', async () => {
    const res = await op('release', 1, { type: 'CART', id: CART });
    expect(res.movement).toMatchObject({
      type: 'RETURN_TO_RACK',
      toRackId: f.rackA,
      fromRackId: null,
    });
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 5, reservedQty: 2 });
    await expect(op('release', 3, { type: 'CART', id: CART })).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_OPERATION',
    });
  });

  it('sell descuenta existencia y reserva, con referencia de la venta', async () => {
    const res = await op('sell', 2, { type: 'SALE', id: SALE });
    expect(res.movement).toMatchObject({ type: 'SALE', referenceType: 'SALE', referenceId: SALE });
    expect(res.balances).toEqual([{ rackId: f.rackA, quantity: 3, reservedQty: 0 }]);
    await expect(op('sell', 1, { type: 'SALE', id: SALE })).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_OPERATION',
    });
  });
});
