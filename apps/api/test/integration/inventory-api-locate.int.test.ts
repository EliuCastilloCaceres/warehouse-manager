import { LocateResultDto, NodeContentDto } from '@warehouse-manager/shared';
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

describe('buscar producto y ubicación', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let seller: Api;
  let clerk: Api;
  let s1: Awaited<ReturnType<typeof warehouseOf>>;
  let s2: Awaited<ReturnType<typeof warehouseOf>>;
  let a: Awaited<ReturnType<typeof createStructure>>;
  let ids: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    // El vendedor solo tiene S1: S2 se consulta en modo lectura.
    seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    clerk = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'almacen', role: 'WAREHOUSE_CLERK' }))
        .accessToken,
    );
    s1 = await warehouseOf(prisma, 'S1');
    s2 = await warehouseOf(prisma, 'S2');
    await prisma.branch.update({ where: { id: s2.branchId }, data: { phone: '55 1234 5678' } });

    a = await createStructure(prisma, s1.id, { zone: 'A', racks: ['01', '02'], color: '#2563EB' });
    const b2 = await createStructure(prisma, s2.id, { zone: 'B' });

    // S3 inactiva, con stock.
    const s3 = await prisma.branch.create({ data: { code: 'S3', name: 'Sucursal 3' } });
    const w3 = await prisma.warehouse.create({
      data: { branchId: s3.id, code: 'ALM1', name: 'Almacén' },
    });
    const c3 = await createStructure(prisma, w3.id, { zone: 'A' });

    ids = (await createProduct(prisma, 'LOC0001', ['NEG', 'CAF', 'BLA'])).variantIds;
    const userId = session.userId;
    const put = (variant: number, rackId: string, quantity: number, reserve = 0) =>
      putStock(prisma, { variantId: ids[variant]!, rackId, quantity, userId, reserve });
    // NEG: 4 en A-01-01 (1 en piso) y 2 en staging de S1; en S2 3 (1 reservada) + 1 en staging.
    await put(0, a.rackIds['A-01-01']!, 4, 1);
    await put(0, s1.staging.rackId, 2);
    await put(0, b2.rackIds['B-01-01']!, 3, 1);
    await put(0, s2.staging.rackId, 1);
    await put(0, c3.rackIds['A-01-01']!, 9);
    await prisma.branch.update({ where: { id: s3.id }, data: { isActive: false } });
    // CAF: 1 en A-01-02 de S1; en S2 todas reservadas (0 disponibles).
    await put(1, a.rackIds['A-01-02']!, 1);
    await put(1, b2.rackIds['B-01-01']!, 2, 2);
    // BLA: tuvo stock en A-01-02 y se vendió todo (fila en 0).
    await put(2, a.rackIds['A-01-02']!, 1);
    await prisma.stockLocation.updateMany({
      where: { variantId: ids[2], rackId: a.rackIds['A-01-02'] },
      data: { quantity: 0 },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const locate = async (api: Api, code: string) => {
    const res = await api.get(`/inventory/locate?code=${encodeURIComponent(code)}`);
    expect(res.statusCode).toBe(200);
    return LocateResultDto.parse(res.json());
  };

  describe('locate (T16)', () => {
    it('por SKU de variante → una variante con sus ubicaciones (staging al final)', async () => {
      const result = await locate(admin, 'loc0001-25-neg');
      expect(result.product.sku).toBe('LOC0001');
      expect(result.variants).toHaveLength(1);
      const [neg] = result.variants;
      expect(neg!.variant.sku).toBe('LOC0001-25-NEG');
      expect(neg!.locations).toEqual([
        {
          rackId: a.rackIds['A-01-01'],
          locationCode: 'A-01-01',
          zoneName: 'Zona A',
          colorHex: '#2563EB',
          isStaging: false,
          quantity: 4,
          reservedQty: 1,
          available: 3,
        },
        {
          rackId: s1.staging.rackId,
          locationCode: 'STG-01-01',
          zoneName: 'Staging',
          colorHex: null,
          isStaging: true,
          quantity: 2,
          reservedQty: 0,
          available: 2,
        },
      ]);
      expect(neg!.totals).toEqual({ quantity: 6, reservedQty: 1, available: 5 });
      expect(neg!.stock).toEqual({ status: 'DISPONIBLE', enPiso: true, enStaging: true });
    });

    it('por SKU padre → todas sus variantes; sin las filas en 0', async () => {
      const result = await locate(admin, 'LOC0001');
      expect(result.variants.map((v) => v.variant.sku)).toEqual([
        'LOC0001-25-BLA',
        'LOC0001-25-CAF',
        'LOC0001-25-NEG',
      ]);
      const [bla, caf] = result.variants;
      expect(bla!.locations).toEqual([]);
      expect(bla!.stock.status).toBe('AGOTADO');
      expect(caf!.locations.map((l) => l.locationCode)).toEqual(['A-01-02']);
      expect(caf!.stock).toEqual({ status: 'BAJO', enPiso: false, enStaging: false });
    });

    it('un código desconocido → 404', async () => {
      const res = await admin.get('/inventory/locate?code=NOEXISTE');
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });
  });

  describe('otras sucursales (T17)', () => {
    it('con el permiso: S2 con su teléfono y disponibles, aunque no la tenga asignada', async () => {
      const [bla, caf, neg] = (await locate(seller, 'LOC0001')).variants;
      expect(neg!.otherBranches).toEqual([
        {
          branchId: s2.branchId,
          code: 'S2',
          name: 'Sucursal 2',
          phone: '55 1234 5678',
          available: 3,
        },
      ]);
      // CAF: en S2 todo está reservado; S3 está inactiva; S1 es la actual.
      expect(caf!.otherBranches).toEqual([]);
      expect(bla!.otherBranches).toEqual([]);
    });

    it('la sucursal actual nunca aparece', async () => {
      const fromS2 = apiAs(app, (await loginSeeded(app, prisma, 'admin')).accessToken, s2.branchId);
      const [neg] = (await locate(fromS2, 'LOC0001-25-NEG')).variants;
      expect(neg!.otherBranches!.map((b) => b.code)).toEqual(['S1']);
      expect(neg!.otherBranches![0]!.available).toBe(5);
      expect(neg!.locations.map((l) => l.locationCode)).toEqual(['B-01-01', 'STG-01-01']);
    });

    it('sin el permiso (Almacenista) → otherBranches: null', async () => {
      const [neg] = (await locate(clerk, 'LOC0001-25-NEG')).variants;
      expect(neg!.otherBranches).toBeNull();
    });
  });

  describe('by-location (T18)', () => {
    it('"a-1-1" → contenido de A-01-01', async () => {
      const res = await seller.get('/inventory/by-location?code=a-1-1');
      expect(res.statusCode).toBe(200);
      const page = NodeContentDto.parse(res.json());
      expect(page.node).toMatchObject({ kind: 'rack', code: 'A-01-01' });
      expect(page.items.map((i) => [i.sku, i.quantity])).toEqual([['LOC0001-25-NEG', 4]]);
      const qr = await seller.get(
        `/inventory/by-location?code=${encodeURIComponent('LOC:A-01-01')}`,
      );
      expect(qr.json().node.id).toBe(a.rackIds['A-01-01']);
    });

    it.each([
      ['un código que solo existe en otra sucursal', 'B-01-01'],
      ['un código inválido', 'A-1'],
      ['un código fuera de rango', 'A-00-01'],
    ])('%s → 404', async (_caso, code) => {
      const res = await seller.get(`/inventory/by-location?code=${code}`);
      expect(res.statusCode).toBe(404);
    });
  });
});
