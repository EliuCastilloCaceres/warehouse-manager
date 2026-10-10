import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestClient } from './helpers/db.js';
import { type InventoryFixture, setupInventory, stockOf } from './helpers/inventory.js';

/** Resultado de cada promesa: 'OK' o el código del error de dominio. */
async function outcomes(promises: Promise<unknown>[]): Promise<string[]> {
  const settled = await Promise.allSettled(promises);
  return settled.map((s) =>
    s.status === 'fulfilled' ? 'OK' : String((s.reason as { code?: string }).code ?? s.reason),
  );
}

describe('concurrencia de inventario', () => {
  let prisma: PrismaClient;
  let f: InventoryFixture;
  const inventory = new InventoryService();

  beforeEach(async () => {
    prisma = createTestClient();
    f = await setupInventory(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  const receive = (rackId: string, quantity: number, variantId = f.variantId) =>
    prisma.$transaction((tx) =>
      inventory.receive(tx, { type: 'PUTAWAY', variantId, rackId, quantity, userId: f.userId }),
    );

  it('2 pick en paralelo de la última unidad → uno OK y uno STOCK_INSUFFICIENT (T38)', async () => {
    await receive(f.rackA, 1);
    const pick = () =>
      prisma.$transaction((tx) =>
        inventory.pick(tx, {
          variantId: f.variantId,
          rackId: f.rackA,
          quantity: 1,
          userId: f.userId,
        }),
      );

    expect((await outcomes([pick(), pick()])).sort()).toEqual(['OK', 'STOCK_INSUFFICIENT']);
    expect(await stockOf(prisma, f.variantId, f.rackA)).toEqual({ quantity: 1, reservedQty: 1 });
  });

  it('2 receive de 3 en paralelo con 6/10 ocupadas → uno OK y uno RACK_CAPACITY_EXCEEDED (T39)', async () => {
    await receive(f.rackA, 6, f.otherVariantId);

    expect((await outcomes([receive(f.rackA, 3), receive(f.rackA, 3)])).sort()).toEqual([
      'OK',
      'RACK_CAPACITY_EXCEEDED',
    ]);
    const occupied = await prisma.stockLocation.aggregate({
      where: { rackId: f.rackA },
      _sum: { quantity: true },
    });
    expect(occupied._sum.quantity).toBe(9);
  });

  it('10 pares de relocate A→B y B→A en paralelo: sin deadlocks y el total se conserva (T40)', async () => {
    await receive(f.rackA, 5);
    await receive(f.rackB, 5);
    const relocate = (fromRackId: string, toRackId: string) =>
      prisma.$transaction((tx) =>
        inventory.relocate(tx, {
          variantId: f.variantId,
          fromRackId,
          toRackId,
          quantity: 1,
          userId: f.userId,
          overrideCapacity: true,
        }),
      );
    const pairs = Array.from({ length: 10 }, () => [
      relocate(f.rackA, f.rackB),
      relocate(f.rackB, f.rackA),
    ]).flat();

    const results = await outcomes(pairs);
    expect(results.filter((r) => r !== 'OK' && r !== 'STOCK_INSUFFICIENT')).toEqual([]);
    const a = await stockOf(prisma, f.variantId, f.rackA);
    const b = await stockOf(prisma, f.variantId, f.rackB);
    expect(a.quantity + b.quantity).toBe(10);
  });
});
