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

  // T24 de F1, adaptado en F7: el seed de demo ahora también crea stock (spec F7 §1).
  it('crea estructura, catálogo y stock, y es idempotente (T24)', async () => {
    await seedBase(prisma, { ownerPassword: 'clave-owner-1', adminPassword: 'clave-admin-1' });

    await seedDemo(prisma);

    expect(await counts(prisma)).toEqual({
      zones: 3,
      containers: 6,
      racks: 24,
      brands: 2,
      products: 4,
      variants: 14,
      stockLocations: 11,
      movements: 11,
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

  it('carga el stock de demo con INITIAL_LOAD y no lo duplica (T27 de F7)', async () => {
    await seedBase(prisma, { ownerPassword: 'clave-owner-1', adminPassword: 'clave-admin-1' });
    await seedDemo(prisma);

    const rows = await prisma.stockLocation.findMany({
      include: { variant: true, rack: { include: { warehouse: { include: { branch: true } } } } },
    });
    const stock = rows
      .map(
        (r) =>
          `${r.rack.warehouse.branch.code} ${r.rack.locationCode} ${r.variant.sku} ${r.quantity}`,
      )
      .sort();
    expect(stock).toEqual([
      'S1 A-01-01 ZAP0101-23-NEG 3',
      'S1 A-01-01 ZAP0101-24-NEG 3',
      'S1 A-01-01 ZAP0101-25-NEG 4',
      'S1 A-01-02 ZAP0101-25-CAF 1',
      'S1 A-01-02 ZAP0101-26-CAF 2',
      'S1 B-01-01 BOL0201-NEG 5',
      'S1 B-01-01 BOL0201-ROJ 2',
      'S1 C-01-01 ACC0301 10',
      'S1 STG-01-01 ZAP0102-26-BLA 2',
      'S2 STG-01-01 ZAP0101-26-NEG 2',
      'S2 STG-01-01 ZAP0102-25-BLA 1',
    ]);
    expect(rows.every((r) => r.reservedQty === 0)).toBe(true);

    const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    const movements = await prisma.inventoryMovement.findMany();
    expect(movements).toHaveLength(11);
    expect(
      movements.every(
        (m) =>
          m.type === 'INITIAL_LOAD' && m.note === 'Demo' && m.userId === owner.id && !m.fromRackId,
      ),
    ).toBe(true);

    // ZAP0101-26-NEG: agotado en S1 y disponible en S2.
    const zap = await prisma.stockLocation.findMany({
      where: { variant: { sku: 'ZAP0101-26-NEG' } },
      include: { rack: { include: { warehouse: { include: { branch: true } } } } },
    });
    expect(zap.map((r) => [r.rack.warehouse.branch.code, r.quantity])).toEqual([['S2', 2]]);

    const second = await seedDemo(prisma);
    expect(second.created).toEqual([]);
    expect(await prisma.inventoryMovement.count()).toBe(11);
    expect(await prisma.stockLocation.aggregate({ _sum: { quantity: true } })).toEqual({
      _sum: { quantity: 35 },
    });
  });

  it('sin seed base lanza "Ejecuta primero `pnpm db:seed`" y no escribe nada (T25)', async () => {
    await expect(seedDemo(prisma)).rejects.toThrow('Ejecuta primero `pnpm db:seed`');

    const tables = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT (SELECT count(*) FROM zone) + (SELECT count(*) FROM brand) + (SELECT count(*) FROM product)
        + (SELECT count(*) FROM product_variant) + (SELECT count(*) FROM rack) AS total`;
    expect(Number(tables[0]!.total)).toBe(0);
  });
});
