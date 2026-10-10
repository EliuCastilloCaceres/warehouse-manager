import type { InventoryMovement } from '../../src/generated/prisma/client.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory } from './helpers/inventory.js';

type Balances = Map<string, { quantity: number; reservedQty: number }>;

/** Aplica la tabla de efectos de F1 §4.5 a los movimientos del kardex, en orden. */
function replay(movements: InventoryMovement[]): Balances {
  const balances: Balances = new Map();
  const at = (variantId: string, rackId: string) => {
    const key = `${variantId}:${rackId}`;
    if (!balances.has(key)) balances.set(key, { quantity: 0, reservedQty: 0 });
    return balances.get(key)!;
  };
  for (const m of movements) {
    const n = m.quantity;
    const from = m.fromRackId ? at(m.variantId, m.fromRackId) : null;
    const to = m.toRackId ? at(m.variantId, m.toRackId) : null;
    switch (m.type) {
      case 'INITIAL_LOAD':
      case 'PUTAWAY':
      case 'ADJUSTMENT_IN':
      case 'SALE_CANCEL':
        to!.quantity += n;
        break;
      case 'RETURN_TO_RACK':
        to!.reservedQty -= n;
        break;
      case 'PICK':
        from!.reservedQty += n;
        break;
      case 'SALE':
        from!.quantity -= n;
        from!.reservedQty -= n;
        break;
      case 'ADJUSTMENT_OUT':
        from!.quantity -= n;
        break;
      case 'RELOCATE':
        from!.quantity -= n;
        to!.quantity += n;
        break;
      case 'TO_STAGING':
        from!.quantity -= n;
        from!.reservedQty -= n;
        to!.quantity += n;
        break;
    }
  }
  return balances;
}

describe('el kardex reproduce el stock (T37)', () => {
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

  it('tras 12 operaciones, el kardex da exactamente quantity y reserved_qty', async () => {
    const u = f.userId;
    const v = f.variantId;
    const w = f.otherVariantId;
    const ops = [
      (tx: never) =>
        inventory.receive(tx, {
          type: 'INITIAL_LOAD',
          variantId: v,
          rackId: f.rackA,
          quantity: 6,
          userId: u,
        }),
      (tx: never) =>
        inventory.receive(tx, {
          type: 'PUTAWAY',
          variantId: w,
          rackId: f.rackB,
          quantity: 4,
          userId: u,
        }),
      (tx: never) => inventory.pick(tx, { variantId: v, rackId: f.rackA, quantity: 3, userId: u }),
      (tx: never) =>
        inventory.relocate(tx, {
          variantId: v,
          fromRackId: f.rackA,
          toRackId: f.rackB,
          quantity: 2,
          userId: u,
        }),
      (tx: never) =>
        inventory.release(tx, { variantId: v, rackId: f.rackA, quantity: 1, userId: u }),
      (tx: never) => inventory.sell(tx, { variantId: v, rackId: f.rackA, quantity: 1, userId: u }),
      (tx: never) =>
        inventory.moveReservedToStaging(tx, {
          variantId: v,
          fromRackId: f.rackA,
          quantity: 1,
          userId: u,
        }),
      (tx: never) =>
        inventory.receive(tx, {
          type: 'ADJUSTMENT_IN',
          variantId: w,
          rackId: f.rackB,
          quantity: 2,
          userId: u,
          note: 'Conteo',
          adjustmentReason: 'PHYSICAL_COUNT',
        }),
      (tx: never) =>
        inventory.adjustOut(tx, {
          variantId: w,
          rackId: f.rackB,
          quantity: 1,
          userId: u,
          note: 'Merma',
          adjustmentReason: 'DAMAGE',
        }),
      (tx: never) => inventory.pick(tx, { variantId: w, rackId: f.rackB, quantity: 2, userId: u }),
      (tx: never) => inventory.sell(tx, { variantId: w, rackId: f.rackB, quantity: 2, userId: u }),
      (tx: never) =>
        inventory.returnCancelledSaleToStaging(tx, {
          variantId: w,
          warehouseId: f.warehouseId,
          quantity: 2,
          userId: u,
        }),
    ];
    expect(ops).toHaveLength(12);
    for (const op of ops) await prisma.$transaction((tx) => op(tx as never));

    const movements = await prisma.inventoryMovement.findMany({ orderBy: { createdAt: 'asc' } });
    expect(movements).toHaveLength(12);
    const replayed = replay(movements);

    const stock = await prisma.stockLocation.findMany();
    expect(stock.length).toBe(replayed.size);
    for (const row of stock) {
      expect({
        key: `${row.variantId}:${row.rackId}`,
        quantity: row.quantity,
        reservedQty: row.reservedQty,
      }).toEqual({
        key: `${row.variantId}:${row.rackId}`,
        ...replayed.get(`${row.variantId}:${row.rackId}`),
      });
    }
  });
});
