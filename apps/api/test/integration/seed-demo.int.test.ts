import { seedBase } from '../../prisma/seed/base.js';
import { seedDemo } from '../../prisma/seed/demo.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';

async function counts(prisma: PrismaClient) {
  return {
    zones: await prisma.zone.count({ where: { isStaging: false } }),
    containers: await prisma.container.count({ where: { zone: { isStaging: false } } }),
    racks: await prisma.rack.count({ where: { container: { zone: { isStaging: false } } } }),
    brands: await prisma.brand.count(),
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    stockLocations: await prisma.stockLocation.count(),
    movements: await prisma.inventoryMovement.count(),
  };
}

describe('seed de demo', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crea estructura y catálogo sin stock, y es idempotente (T24)', async () => {
    await seedBase(prisma, { ownerPassword: 'clave-owner-1', adminPassword: 'clave-admin-1' });

    await seedDemo(prisma);

    expect(await counts(prisma)).toEqual({
      zones: 3,
      containers: 6,
      racks: 24,
      brands: 2,
      products: 4,
      variants: 14,
      stockLocations: 0,
      movements: 0,
    });

    const racks = await prisma.rack.findMany({
      where: { container: { zone: { isStaging: false } } },
      orderBy: { locationCode: 'asc' },
    });
    expect(racks[0]!.locationCode).toBe('A-01-01');
    expect(racks.at(-1)!.locationCode).toBe('C-02-04');
    expect(racks.every((r) => r.capacityUnits === 40)).toBe(true);

    const zones = await prisma.zone.findMany({
      where: { isStaging: false },
      orderBy: { sortOrder: 'asc' },
    });
    expect(zones.map((z) => [z.code, z.color, z.sortOrder])).toEqual([
      ['A', '#2563EB', 1],
      ['B', '#16A34A', 2],
      ['C', '#DC2626', 3],
    ]);

    const zap = await prisma.product.findUniqueOrThrow({
      where: { sku: 'ZAP0101' },
      include: { variants: true, category: true, brand: true },
    });
    expect(zap).toMatchObject({ type: 'VARIABLE', price: 89900, cost: 45000 });
    expect(zap.category?.name).toBe('Calzado');
    expect(zap.brand?.name).toBe('Demo Calzado');
    expect(zap.variants.map((v) => v.sku).sort()).toEqual(
      ['23', '24', '25', '26'].flatMap((s) => [`ZAP0101-${s}-CAF`, `ZAP0101-${s}-NEG`]).sort(),
    );

    const belt = await prisma.product.findUniqueOrThrow({
      where: { sku: 'ACC0301' },
      include: { variants: true, brand: true },
    });
    expect(belt).toMatchObject({ type: 'SIMPLE', price: 34900, brand: null });
    expect(belt.variants).toEqual([
      expect.objectContaining({ sku: 'ACC0301', size: null, color: null, material: null }),
    ]);

    const second = await seedDemo(prisma);
    expect(second.created).toEqual([]);
    expect((await counts(prisma)).variants).toBe(14);
    expect((await counts(prisma)).racks).toBe(24);
  });

  it('sin seed base lanza "Ejecuta primero `pnpm db:seed`" y no escribe nada (T25)', async () => {
    await expect(seedDemo(prisma)).rejects.toThrow('Ejecuta primero `pnpm db:seed`');

    const tables = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT (SELECT count(*) FROM zone) + (SELECT count(*) FROM brand) + (SELECT count(*) FROM product)
        + (SELECT count(*) FROM product_variant) + (SELECT count(*) FROM rack) AS total`;
    expect(Number(tables[0]!.total)).toBe(0);
  });
});
