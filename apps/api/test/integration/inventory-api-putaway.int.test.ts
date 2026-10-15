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

describe('ubicar', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let clerk: Api;
  let w: Awaited<ReturnType<typeof warehouseOf>>;
  let racks: Record<string, string>;
  let variants: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    clerk = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'almacen', role: 'WAREHOUSE_CLERK' }))
        .accessToken,
    );
    w = await warehouseOf(prisma);
    racks = (
      await createStructure(prisma, w.id, { zone: 'A', racks: ['01', '02', '03'], capacity: 10 })
    ).rackIds;
    variants = (await createProduct(prisma, 'UBI0001', ['NEG', 'CAF', 'BLA'])).variantIds;
    await putStock(prisma, {
      variantId: variants[0]!,
      rackId: w.staging.rackId,
      quantity: 5,
      userId: session.userId,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const putaway = (api: Api, payload: object) => api.post('/inventory/putaway', payload);

  describe('individual (T20)', () => {
    it('desde staging → RELOCATE desde STG-01-01 y staging disminuye', async () => {
      const res = await putaway(clerk, {
        variantId: variants[0],
        rackId: racks['A-01-01'],
        quantity: 3,
        source: 'STAGING',
      });
      expect(res.statusCode).toBe(200);
      const op = StockOperationDto.parse(res.json());
      expect(op.movements).toEqual([
        expect.objectContaining({
          type: 'RELOCATE',
          fromRackId: w.staging.rackId,
          toRackId: racks['A-01-01'],
          quantity: 3,
          capacityOverridden: false,
        }),
      ]);
      expect(op.balances).toEqual(
        expect.arrayContaining([
          { rackId: w.staging.rackId, variantId: variants[0], quantity: 2, reservedQty: 0 },
          { rackId: racks['A-01-01'], variantId: variants[0], quantity: 3, reservedQty: 0 },
        ]),
      );
      expect(await stockOf(prisma, variants[0]!, w.staging.rackId)).toEqual({
        quantity: 2,
        reservedQty: 0,
      });
    });

    it('staging insuficiente → 409 STOCK_INSUFFICIENT con los disponibles', async () => {
      const res = await putaway(clerk, {
        variantId: variants[0],
        rackId: racks['A-01-01'],
        quantity: 3,
        source: 'STAGING',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'STOCK_INSUFFICIENT',
        details: { available: 2, requested: 3 },
      });
    });

    it('mercancía nueva → PUTAWAY y suma stock', async () => {
      const res = await putaway(clerk, {
        variantId: variants[1],
        rackId: racks['A-01-02'],
        quantity: 4,
        source: 'NEW',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().movements[0]).toMatchObject({ type: 'PUTAWAY', fromRackId: null });
      expect(await stockOf(prisma, variants[1]!, racks['A-01-02']!)).toEqual({
        quantity: 4,
        reservedQty: 0,
      });
    });

    it('destino staging → 400; sin inventory.putaway → 403', async () => {
      const staging = await putaway(admin, {
        variantId: variants[1],
        rackId: w.staging.rackId,
        quantity: 1,
        source: 'NEW',
      });
      expect(staging.statusCode).toBe(400);
      expect(staging.json().details).toEqual([
        { path: 'rackId', message: 'El destino no puede ser staging' },
      ]);

      const seller = apiAs(
        app,
        (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
      );
      const res = await putaway(seller, {
        variantId: variants[1],
        rackId: racks['A-01-02'],
        quantity: 1,
        source: 'NEW',
      });
      expect(res.statusCode).toBe(403);
    });

    it('un rack inactivo → 409 RACK_INACTIVE; uno de otra sucursal sin acceso → 403', async () => {
      await prisma.rack.update({ where: { id: racks['A-01-03'] }, data: { isActive: false } });
      const inactive = await putaway(admin, {
        variantId: variants[1],
        rackId: racks['A-01-03'],
        quantity: 1,
        source: 'NEW',
      });
      expect(inactive.json().code).toBe('RACK_INACTIVE');
      await prisma.rack.update({ where: { id: racks['A-01-03'] }, data: { isActive: true } });

      const s2 = await warehouseOf(prisma, 'S2');
      const other = (await createStructure(prisma, s2.id, { zone: 'A' })).rackIds['A-01-01'];
      const forbidden = await putaway(clerk, {
        variantId: variants[1],
        rackId: other,
        quantity: 1,
        source: 'NEW',
      });
      expect(forbidden.json().code).toBe('BRANCH_FORBIDDEN');
    });
  });

  describe('en lote (T21)', () => {
    it('3 ítems de origen mixto → un StockOperationDto con 3 movimientos', async () => {
      // A-01-03 vacío, capacidad 10.
      const res = await admin.post('/inventory/putaway/batch', {
        rackId: racks['A-01-03'],
        items: [
          { variantId: variants[0], quantity: 2, source: 'STAGING' },
          { variantId: variants[1], quantity: 3, source: 'NEW' },
          { variantId: variants[2], quantity: 1, source: 'NEW' },
        ],
      });
      expect(res.statusCode).toBe(200);
      const op = StockOperationDto.parse(res.json());
      expect(op.movements.map((m) => [m.type, m.quantity])).toEqual([
        ['RELOCATE', 2],
        ['PUTAWAY', 3],
        ['PUTAWAY', 1],
      ]);
    });

    it('si el tercero excede la capacidad → 409 con itemIndex 2 y no se aplica ninguno', async () => {
      // A-01-03 tiene 6 de 10.
      const before = await prisma.inventoryMovement.count();
      const payload = {
        rackId: racks['A-01-03'],
        items: [
          { variantId: variants[0], quantity: 1, source: 'NEW' },
          { variantId: variants[1], quantity: 1, source: 'NEW' },
          { variantId: variants[2], quantity: 3, source: 'NEW' },
        ],
      };
      const res = await admin.post('/inventory/putaway/batch', payload);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'RACK_CAPACITY_EXCEEDED',
        details: { itemIndex: 2, capacity: 10, occupied: 8, requested: 3 },
      });
      expect(await prisma.inventoryMovement.count()).toBe(before);
      expect(await stockOf(prisma, variants[0]!, racks['A-01-03']!)).toEqual({
        quantity: 2,
        reservedQty: 0,
      });

      const forbidden = await clerk.post('/inventory/putaway/batch', {
        ...payload,
        overrideCapacity: true,
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().details).toEqual({ permission: 'inventory.override_capacity' });

      const ok = await admin.post('/inventory/putaway/batch', {
        ...payload,
        overrideCapacity: true,
      });
      expect(ok.statusCode).toBe(200);
      expect(
        ok.json().movements.map((m: { capacityOverridden: boolean }) => m.capacityOverridden),
      ).toEqual([false, false, true]);
    });

    it('una variante repetida o un ítem inexistente → error sin aplicar nada', async () => {
      const repeated = await admin.post('/inventory/putaway/batch', {
        rackId: racks['A-01-02'],
        items: [
          { variantId: variants[0], quantity: 1, source: 'NEW' },
          { variantId: variants[0], quantity: 1, source: 'NEW' },
        ],
      });
      expect(repeated.statusCode).toBe(400);
      const missing = await admin.post('/inventory/putaway/batch', {
        rackId: racks['A-01-02'],
        items: [
          { variantId: variants[0], quantity: 1, source: 'NEW' },
          { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1, source: 'NEW' },
        ],
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().details).toEqual({ itemIndex: 1 });
    });
  });
});
