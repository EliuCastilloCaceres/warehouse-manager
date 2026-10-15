import { StockOperationDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { stockOf } from './helpers/inventory.js';
import { resetWithSeed } from './helpers/seed.js';
import {
  type Api,
  apiAs,
  createProduct,
  createStructure,
  putStock,
  warehouseOf,
} from './helpers/warehouse.js';

describe('reubicar (T22)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let seller: Api;
  let w: Awaited<ReturnType<typeof warehouseOf>>;
  let racks: Record<string, string>;
  let variants: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    // El Vendedor tiene inventory.relocate para regresar productos.
    seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    w = await warehouseOf(prisma);
    racks = (
      await createStructure(prisma, w.id, {
        zone: 'A',
        racks: ['01', '02', '03', '04'],
        capacity: 10,
      })
    ).rackIds;
    variants = (await createProduct(prisma, 'REU0001', ['NEG', 'CAF'])).variantIds;
    const put = (variant: number, rack: string, quantity: number, reserve = 0) =>
      putStock(prisma, {
        variantId: variants[variant]!,
        rackId: racks[rack]!,
        quantity,
        userId: session.userId,
        reserve,
      });
    await put(0, 'A-01-01', 5, 2); // 2 en piso
    await put(1, 'A-01-01', 3);
    await put(0, 'A-01-04', 9); // casi lleno
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const relocate = (api: Api, payload: object) => api.post('/inventory/relocate', payload);

  it('reubicar ítems → RELOCATE', async () => {
    const res = await relocate(seller, {
      fromRackId: racks['A-01-01'],
      toRackId: racks['A-01-02'],
      items: [{ variantId: variants[1], quantity: 1 }],
    });
    expect(res.statusCode).toBe(200);
    const op = StockOperationDto.parse(res.json());
    expect(op.movements).toEqual([
      expect.objectContaining({
        type: 'RELOCATE',
        fromRackId: racks['A-01-01'],
        toRackId: racks['A-01-02'],
        quantity: 1,
      }),
    ]);
    expect(await stockOf(prisma, variants[1]!, racks['A-01-02']!)).toEqual({
      quantity: 1,
      reservedQty: 0,
    });
  });

  it('all: true mueve solo las disponibles; las reservadas se quedan', async () => {
    const res = await relocate(admin, {
      fromRackId: racks['A-01-01'],
      toRackId: racks['A-01-03'],
      all: true,
    });
    expect(res.statusCode).toBe(200);
    const op = StockOperationDto.parse(res.json());
    expect(op.movements.map((m) => [m.variantId, m.quantity])).toEqual([
      [variants[1], 2], // CAF
      [variants[0], 3], // NEG: 5 − 2 reservadas
    ]);
    expect(await stockOf(prisma, variants[0]!, racks['A-01-01']!)).toEqual({
      quantity: 2,
      reservedQty: 2,
    });
    expect(await stockOf(prisma, variants[1]!, racks['A-01-01']!)).toEqual({
      quantity: 0,
      reservedQty: 0,
    });

    const nothing = await relocate(admin, {
      fromRackId: racks['A-01-01'],
      toRackId: racks['A-01-03'],
      all: true,
    });
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json().code).toBe('STOCK_INSUFFICIENT');
  });

  it('hacia staging → OK', async () => {
    const res = await relocate(seller, {
      fromRackId: racks['A-01-03'],
      toRackId: w.staging.rackId,
      items: [{ variantId: variants[0], quantity: 3 }],
    });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(prisma, variants[0]!, w.staging.rackId)).toEqual({
      quantity: 3,
      reservedQty: 0,
    });
  });

  it('hacia un rack de S2 → 409 INVENTORY_CROSS_WAREHOUSE', async () => {
    const s2 = await warehouseOf(prisma, 'S2');
    const res = await relocate(admin, {
      fromRackId: racks['A-01-03'],
      toRackId: s2.staging.rackId,
      items: [{ variantId: variants[1], quantity: 1 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVENTORY_CROSS_WAREHOUSE');
    // El vendedor no tiene S2: ni siquiera llega a la validación del almacén.
    const forbidden = await relocate(seller, {
      fromRackId: racks['A-01-03'],
      toRackId: s2.staging.rackId,
      items: [{ variantId: variants[1], quantity: 1 }],
    });
    expect(forbidden.json().code).toBe('BRANCH_FORBIDDEN');
  });

  it('destino lleno → RACK_CAPACITY_EXCEEDED sin mover nada', async () => {
    const res = await relocate(admin, {
      fromRackId: racks['A-01-03'],
      toRackId: racks['A-01-04'],
      items: [{ variantId: variants[1], quantity: 2 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'RACK_CAPACITY_EXCEEDED',
      details: { locationCode: 'A-01-04', itemIndex: 0 },
    });
    expect(await stockOf(prisma, variants[1]!, racks['A-01-03']!)).toEqual({
      quantity: 2,
      reservedQty: 0,
    });
  });

  it('el mismo rack como origen y destino → 400', async () => {
    const res = await relocate(admin, {
      fromRackId: racks['A-01-03'],
      toRackId: racks['A-01-03'],
      all: true,
    });
    expect(res.statusCode).toBe(400);
  });
});
