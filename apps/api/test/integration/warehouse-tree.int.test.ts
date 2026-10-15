import { NodeContentDto, type OccupancyDto, WarehouseTreeDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { imageUrls } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';
import {
  type Api,
  apiAs,
  createProduct,
  createStructure,
  putStock,
  warehouseOf,
} from './helpers/warehouse.js';

describe('árbol y contenido del almacén', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let w: Awaited<ReturnType<typeof warehouseOf>>;
  let x: Awaited<ReturnType<typeof createStructure>>;
  let y: Awaited<ReturnType<typeof createStructure>>;
  let v: Record<string, string>;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    w = await warehouseOf(prisma);

    x = await createStructure(prisma, w.id, {
      zone: 'X',
      containers: ['01', '02'],
      racks: ['01', '02', '03'],
      color: '#2563EB',
    });
    y = await createStructure(prisma, w.id, { zone: 'Y', racks: ['01', '02'] });
    // X-02 solo con 2 racks; X-02-02 inactivo (sin stock).
    await prisma.rack.delete({ where: { id: x.rackIds['X-02-03'] } });
    await prisma.rack.update({ where: { id: x.rackIds['X-02-02'] }, data: { isActive: false } });
    await prisma.rack.update({
      where: { id: x.rackIds['X-01-01'] },
      data: { labelColor: '#DC2626' },
    });

    const p1 = await createProduct(prisma, 'TRE0001', ['NEG', 'CAF']);
    const p2 = await createProduct(prisma, 'TRE0002', ['NEG', 'BLA']);
    const p3 = await createProduct(prisma, 'TRE0003', ['NEG', 'ROJ']);
    v = {
      v1: p1.variantIds[0]!,
      v2: p1.variantIds[1]!,
      w1: p2.variantIds[0]!,
      w2: p2.variantIds[1]!,
      u1: p3.variantIds[0]!,
      z1: p3.variantIds[1]!,
    };
    await prisma.productImage.create({
      data: { productId: p1.productId, sortOrder: 0, ...imageUrls(1) },
    });

    const userId = session.userId;
    const put = (variant: string, rackId: string, quantity: number, reserve = 0) =>
      putStock(prisma, { variantId: v[variant]!, rackId, quantity, userId, reserve });
    await put('v1', x.rackIds['X-01-01']!, 10, 2);
    await put('z1', x.rackIds['X-01-01']!, 1);
    await put('v1', x.rackIds['X-01-02']!, 5);
    await put('v2', x.rackIds['X-01-02']!, 1);
    await put('w1', x.rackIds['X-01-03']!, 38);
    await put('u1', x.rackIds['X-02-01']!, 1);
    await put('u1', y.rackIds['Y-01-01']!, 1);
    await put('w1', y.rackIds['Y-01-02']!, 5);
    await put('w2', w.staging.rackId, 3);
    // z1 se queda en 0: su fila de stock se conserva (AGOTADO).
    await prisma.$transaction((tx) =>
      new InventoryService().adjustOut(tx, {
        variantId: v.z1!,
        rackId: x.rackIds['X-01-01']!,
        quantity: 1,
        userId,
        note: 'Prueba',
        adjustmentReason: 'LOSS',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const tree = async (query = '') => {
    const res = await admin.get(`/warehouses/${w.id}/tree${query}`);
    expect(res.statusCode).toBe(200);
    return WarehouseTreeDto.parse(res.json());
  };
  const content = async (url: string) => {
    const res = await admin.get(url);
    expect(res.statusCode).toBe(200);
    return NodeContentDto.parse(res.json());
  };
  const units = (o: OccupancyDto) => [o.capacity, o.occupied, o.reserved];

  describe('árbol (T14)', () => {
    it('la ocupación de contenedor, zona y almacén es la suma de sus racks activos', async () => {
      const t = await tree();
      expect(t.zones.map((z) => z.code)).toEqual(['X', 'Y']); // staging va aparte
      const sum = (list: OccupancyDto[]) =>
        list.reduce(
          (acc, o) => [acc[0]! + o.capacity, acc[1]! + o.occupied, acc[2]! + o.reserved],
          [0, 0, 0],
        );
      for (const zone of t.zones) {
        for (const container of zone.containers) {
          const active = container.racks.filter((r) => r.isActive).map((r) => r.occupancy);
          expect(units(container.occupancy)).toEqual(sum(active));
        }
        expect(units(zone.occupancy)).toEqual(sum(zone.containers.map((c) => c.occupancy)));
      }
      expect(units(t.totals)).toEqual(sum(t.zones.map((z) => z.occupancy)));

      const [zx, zy] = t.zones;
      expect(units(zx!.containers[0]!.occupancy)).toEqual([120, 54, 2]);
      expect(units(zx!.containers[1]!.occupancy)).toEqual([40, 1, 0]); // sin X-02-02 inactivo
      expect(zx!.occupancy).toEqual({
        capacity: 160,
        occupied: 55,
        reserved: 2,
        free: 105,
        pct: 34.4,
        level: 'green',
      });
      expect(units(zy!.occupancy)).toEqual([80, 6, 0]);
      expect(t.totals).toMatchObject({ capacity: 240, occupied: 61, reserved: 2, free: 179 });
      expect(t.staging).toEqual({
        rackId: w.staging.rackId,
        locationCode: 'STG-01-01',
        occupied: 3,
        reserved: 0,
      });
    });

    it('nivel y color por rack', async () => {
      const racks = (await tree()).zones[0]!.containers[0]!.racks;
      expect(racks.map((r) => [r.locationCode, r.occupancy.pct, r.occupancy.level])).toEqual([
        ['X-01-01', 25, 'green'],
        ['X-01-02', 15, 'green'],
        ['X-01-03', 95, 'red'],
      ]);
      expect(racks.map((r) => r.colorHex)).toEqual(['#DC2626', '#2563EB', '#2563EB']);
      expect(racks[0]).not.toHaveProperty('matchCount');
    });

    it('con includeInactive el rack inactivo aparece pero no suma', async () => {
      const container = (await tree('?includeInactive=true')).zones[0]!.containers[1]!;
      expect(container.racks.map((r) => [r.code, r.isActive])).toEqual([
        ['01', true],
        ['02', false],
      ]);
      expect(units(container.occupancy)).toEqual([40, 1, 0]);
    });

    it('con status=BAJO, matchCount por nodo', async () => {
      const t = await tree('?status=BAJO');
      const [zx, zy] = t.zones;
      expect(zx!.matchCount).toBe(2); // v2 y u1
      expect(zx!.containers.map((c) => c.matchCount)).toEqual([1, 1]);
      expect(zx!.containers[0]!.racks.map((r) => r.matchCount)).toEqual([0, 1, 0]);
      expect(zy!.matchCount).toBe(1);
      expect(zy!.containers[0]!.racks.map((r) => r.matchCount)).toEqual([1, 0]);
      expect(t.staging.matchCount).toBe(0);

      const piso = await tree('?status=EN_PISO');
      expect(piso.zones[0]!.containers[0]!.racks.map((r) => r.matchCount)).toEqual([1, 0, 0]);
      const agotado = await tree('?status=AGOTADO');
      expect(agotado.zones[0]!.matchCount).toBe(1); // z1, con fila en 0
      expect((await tree('?status=EN_STAGING')).staging.matchCount).toBe(1);
    });
  });

  describe('contenido (T15)', () => {
    it('GET /racks/:id → filas con miniatura, cantidades y estado', async () => {
      const page = await content(`/racks/${x.rackIds['X-01-01']}`);
      expect(page.node).toMatchObject({
        kind: 'rack',
        code: 'X-01-01',
        colorHex: '#DC2626',
        isStaging: false,
        occupancy: { capacity: 40, occupied: 10, reserved: 2, level: 'green' },
      });
      expect(page).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(page.items).toEqual([
        {
          variantId: v.v1,
          sku: 'TRE0001-25-NEG',
          productName: 'Producto TRE0001',
          variantLabel: '25 · NEG',
          thumbUrl: imageUrls(1).thumbUrl,
          quantity: 10,
          reservedQty: 2,
          available: 8,
          stock: { status: 'DISPONIBLE', enPiso: true, enStaging: false },
        },
      ]);
    });

    it('una fila con quantity 0 solo aparece con status=AGOTADO', async () => {
      const agotado = await content(`/racks/${x.rackIds['X-01-01']}?status=AGOTADO`);
      expect(agotado.items.map((i) => [i.sku, i.quantity, i.stock.status])).toEqual([
        ['TRE0003-25-ROJ', 0, 'AGOTADO'],
      ]);
    });

    it('contenedor y zona agregan por variante; filtros, búsqueda y paginación', async () => {
      const container = await content(`/containers/${x.containerIds['01']}`);
      expect(container.node).toMatchObject({
        kind: 'container',
        code: 'X-01',
        occupancy: { capacity: 120, occupied: 54 },
      });
      expect(container.items.map((i) => [i.sku, i.quantity, i.reservedQty])).toEqual([
        ['TRE0001-25-CAF', 1, 0],
        ['TRE0001-25-NEG', 15, 2],
        ['TRE0002-25-NEG', 38, 0],
      ]);
      expect(container.items[0]!.stock.status).toBe('BAJO');

      const zone = await content(`/zones/${x.zoneId}`);
      expect(zone.node).toMatchObject({ kind: 'zone', code: 'X', name: 'Zona X' });
      expect(zone.items.map((i) => [i.sku, i.quantity])).toEqual([
        ['TRE0001-25-CAF', 1],
        ['TRE0001-25-NEG', 15],
        ['TRE0002-25-NEG', 38],
        ['TRE0003-25-NEG', 1],
      ]);
      // u1 tiene 2 en la sucursal (X y Y): su estado es de la sucursal, no del nodo.
      expect(zone.items[3]!.stock.status).toBe('BAJO');

      const paged = await content(`/zones/${x.zoneId}?pageSize=2&page=2`);
      expect(paged).toMatchObject({ page: 2, pageSize: 2, total: 4 });
      expect(paged.items.map((i) => i.sku)).toEqual(['TRE0002-25-NEG', 'TRE0003-25-NEG']);
      const piso = await content(`/zones/${x.zoneId}?status=EN_PISO`);
      expect(piso.items.map((i) => i.sku)).toEqual(['TRE0001-25-NEG']);
      const search = await content(`/zones/${x.zoneId}?q=tre0002`);
      expect(search.items.map((i) => i.sku)).toEqual(['TRE0002-25-NEG']);
      // Los comodines de LIKE se buscan como texto.
      for (const q of ['%', '_', 'TRE%01']) {
        const literal = await content(`/zones/${x.zoneId}?q=${encodeURIComponent(q)}`);
        expect(literal.items).toEqual([]);
      }
    });

    it('el staging no tiene límite y marca enStaging', async () => {
      const staging = await content(`/racks/${w.staging.rackId}?status=EN_STAGING`);
      expect(staging.node).toMatchObject({
        isStaging: true,
        occupancy: { occupied: 3, free: 0, pct: null, level: 'none' },
      });
      expect(staging.items.map((i) => [i.sku, i.stock])).toEqual([
        ['TRE0002-25-BLA', { status: 'DISPONIBLE', enPiso: false, enStaging: true }],
      ]);
    });

    it('un nodo de otra sucursal → 403; uno que no existe → 404', async () => {
      const seller = apiAs(
        app,
        (
          await createAndLogin(app, prisma, {
            username: 'solo-s2',
            role: 'SELLER',
            branches: ['S2'],
          })
        ).accessToken,
      );
      expect((await seller.get(`/racks/${x.rackIds['X-01-01']}`)).json().code).toBe(
        'BRANCH_FORBIDDEN',
      );
      expect((await seller.get(`/warehouses/${w.id}/tree`)).statusCode).toBe(403);
      expect((await admin.get('/zones/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    });
  });
});
