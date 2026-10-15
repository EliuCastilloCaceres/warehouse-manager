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

describe('ajustar (T23)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let adminId: string;
  let rackId: string;
  let variantId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    adminId = session.userId;
    const w = await warehouseOf(prisma);
    rackId = (await createStructure(prisma, w.id, { zone: 'A', capacity: 10 })).rackIds['A-01-01']!;
    [variantId] = (await createProduct(prisma, 'AJU0001')).variantIds as [string];
    await putStock(prisma, { variantId, rackId, quantity: 4, userId: adminId, reserve: 1 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const adjust = (api: Api, payload: object) =>
    api.post('/inventory/adjust', {
      variantId,
      rackId,
      quantity: 2,
      reason: 'PHYSICAL_COUNT',
      note: 'Conteo de octubre',
      ...payload,
    });

  it('entrada con motivo y nota → ADJUSTMENT_IN con el motivo guardado y audit', async () => {
    const res = await adjust(admin, { direction: 'IN' });
    expect(res.statusCode).toBe(200);
    const op = StockOperationDto.parse(res.json());
    expect(op.movements[0]).toMatchObject({
      type: 'ADJUSTMENT_IN',
      toRackId: rackId,
      quantity: 2,
      adjustmentReason: 'PHYSICAL_COUNT',
      note: 'Conteo de octubre',
      userId: adminId,
    });
    expect(await stockOf(prisma, variantId, rackId)).toEqual({ quantity: 6, reservedQty: 1 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'inventory.adjust', entityId: op.movements[0]!.id },
    });
    expect(audit).toMatchObject({ entity: 'InventoryMovement', userId: adminId });
    expect(audit.payload).toMatchObject({
      direction: 'IN',
      locationCode: 'A-01-01',
      reason: 'PHYSICAL_COUNT',
      quantity: 2,
    });
  });

  it('salida de disponibles → ADJUSTMENT_OUT; mayor que lo disponible → STOCK_INSUFFICIENT', async () => {
    const out = await adjust(admin, { direction: 'OUT', quantity: 1, reason: 'DAMAGE' });
    expect(out.json().movements[0]).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      fromRackId: rackId,
      adjustmentReason: 'DAMAGE',
    });
    // 5 en el rack, 1 en piso: hay 4 disponibles.
    const res = await adjust(admin, { direction: 'OUT', quantity: 5, reason: 'LOSS' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { available: 4, requested: 5 },
    });
  });

  it('entrada que excede la capacidad: 409, y con override y permiso, OK', async () => {
    const res = await adjust(admin, { direction: 'IN', quantity: 6, reason: 'FOUND' });
    expect(res.json().code).toBe('RACK_CAPACITY_EXCEEDED');
    const ok = await adjust(admin, {
      direction: 'IN',
      quantity: 6,
      reason: 'FOUND',
      overrideCapacity: true,
    });
    expect(ok.json().movements[0].capacityOverridden).toBe(true);
  });

  it.each([
    ['sin nota', { note: ' ' }],
    ['sin motivo', { reason: undefined }],
    ['con un motivo inválido', { reason: 'ROBO' }],
  ])('%s → 400', async (_caso, payload) => {
    const res = await adjust(admin, { direction: 'OUT', ...payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['Vendedor', 'SELLER'],
    ['Almacenista', 'WAREHOUSE_CLERK'],
  ] as const)('%s (sin inventory.adjust) → 403', async (_rol, role) => {
    const api = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: `ajuste-${role.toLowerCase()}`, role }))
        .accessToken,
    );
    const res = await adjust(api, { direction: 'IN' });
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toEqual({ permission: 'inventory.adjust' });
  });
});
