import { MovementPageDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import {
  type Api,
  apiAs,
  createProduct,
  createStructure,
  putStock,
  warehouseOf,
} from './helpers/warehouse.js';

describe('kardex (T24)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let clerkId: string;
  let s2BranchId: string;
  let v: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    const clerkSession = await createAndLogin(app, prisma, {
      username: 'almacen',
      fullName: 'Ana Almacén',
      role: 'WAREHOUSE_CLERK',
    });
    clerkId = clerkSession.userId;
    const clerk = apiAs(app, clerkSession.accessToken);

    const s1 = await warehouseOf(prisma, 'S1');
    const s2 = await warehouseOf(prisma, 'S2');
    s2BranchId = s2.branchId;
    const a = (await createStructure(prisma, s1.id, { zone: 'A', racks: ['01', '02'] })).rackIds;
    const b = (await createStructure(prisma, s2.id, { zone: 'B' })).rackIds;
    v = [
      ...(await createProduct(prisma, 'MOV0001', ['NEG', 'CAF'])).variantIds,
      ...(await createProduct(prisma, 'MOV0002')).variantIds,
    ];

    // El más antiguo: 2026-10-02T05:30Z = 1 oct, 23:30 en Ciudad de México.
    await prisma.inventoryMovement.create({
      data: {
        variantId: v[2]!,
        toRackId: a['A-01-01']!,
        quantity: 1,
        type: 'ADJUSTMENT_IN',
        adjustmentReason: 'FOUND',
        note: 'Apareció en la bodega',
        userId: session.userId,
        createdAt: new Date('2026-10-02T05:30:00Z'),
      },
    });
    await putStock(prisma, {
      variantId: v[0]!,
      rackId: a['A-01-01']!,
      quantity: 5,
      userId: session.userId,
    });
    await clerk.post('/inventory/putaway', {
      variantId: v[1],
      rackId: a['A-01-02'],
      quantity: 2,
      source: 'NEW',
    });
    await admin.post('/inventory/relocate', {
      fromRackId: a['A-01-01'],
      toRackId: a['A-01-02'],
      items: [{ variantId: v[0], quantity: 1 }],
    });
    await putStock(prisma, {
      variantId: v[0]!,
      rackId: b['B-01-01']!,
      quantity: 3,
      userId: session.userId,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const movements = async (query = '', api = admin) => {
    const res = await api.get(`/inventory/movements${query}`);
    expect(res.statusCode).toBe(200);
    return MovementPageDto.parse(res.json());
  };
  const types = (page: { items: { type: string }[] }) => page.items.map((m) => m.type);

  it('solo los de la sucursal, del más reciente al más antiguo, con sus datos', async () => {
    const page = await movements();
    expect(page).toMatchObject({ total: 4, timezone: 'America/Mexico_City' });
    expect(types(page)).toEqual(['RELOCATE', 'PUTAWAY', 'PUTAWAY', 'ADJUSTMENT_IN']);
    expect(page.items[0]).toMatchObject({
      sku: 'MOV0001-25-NEG',
      productName: 'Producto MOV0001',
      variantLabel: '25 · NEG',
      fromLocationCode: 'A-01-01',
      toLocationCode: 'A-01-02',
      quantity: 1,
    });
    expect(page.items[1]).toMatchObject({
      sku: 'MOV0001-25-CAF',
      fromLocationCode: null,
      user: { id: clerkId, fullName: 'Ana Almacén' },
    });
    expect(page.items[3]).toMatchObject({
      adjustmentReason: 'FOUND',
      note: 'Apareció en la bodega',
    });

    const second = await movements('?pageSize=2&page=2');
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect(types(second)).toEqual(['PUTAWAY', 'ADJUSTMENT_IN']);
  });

  it('filtra por sku (de variante o padre), ubicación, tipos y usuario', async () => {
    expect((await movements('?sku=mov0001-25-neg')).total).toBe(2);
    expect((await movements('?sku=MOV0001')).total).toBe(3);
    expect(types(await movements('?locationCode=a-1-2'))).toEqual(['RELOCATE', 'PUTAWAY']);
    expect((await movements('?locationCode=Z-01-01')).total).toBe(0);
    expect((await movements(`?variantId=${v[2]}`)).total).toBe(1);
    expect(types(await movements('?types=PUTAWAY,RELOCATE'))).toEqual([
      'RELOCATE',
      'PUTAWAY',
      'PUTAWAY',
    ]);
    expect(types(await movements(`?userId=${clerkId}`))).toEqual(['PUTAWAY']);
    expect((await movements(`?q=${encodeURIComponent('producto mov0002')}`)).total).toBe(1);
  });

  it('las fechas son días locales de la sucursal (Ciudad de México)', async () => {
    expect(types(await movements('?from=2026-10-01&to=2026-10-01'))).toEqual(['ADJUSTMENT_IN']);
    expect((await movements('?from=2026-10-02&to=2026-10-02')).total).toBe(0);
    expect((await movements('?to=2026-10-01')).total).toBe(1);
    expect((await movements('?from=2026-10-02')).total).toBe(3);
    const invalid = await admin.get('/inventory/movements?from=2026-10-02&to=2026-10-01');
    expect(invalid.statusCode).toBe(400);
  });

  it('los movimientos de S2 no aparecen en S1, sí en S2', async () => {
    const s2 = apiAs(app, (await loginSeeded(app, prisma, 'admin')).accessToken, s2BranchId);
    const page = await movements('', s2);
    expect(page.items.map((m) => m.toLocationCode)).toEqual(['B-01-01']);
  });

  it('el Vendedor (sin inventory.movements.read) → 403', async () => {
    const seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    const res = await seller.get('/inventory/movements');
    expect(res.statusCode).toBe(403);
  });
});
