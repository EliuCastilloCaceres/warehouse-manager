import { LocationLabelDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { type Api, apiAs, createStructure, warehouseOf } from './helpers/warehouse.js';

describe('etiquetas de ubicación (T25)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let clerk: Api;
  let w: Awaited<ReturnType<typeof warehouseOf>>;
  let a: Awaited<ReturnType<typeof createStructure>>;
  let big: Awaited<ReturnType<typeof createStructure>>;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    await loginSeeded(app, prisma, 'admin');
    clerk = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'almacen', role: 'WAREHOUSE_CLERK' }))
        .accessToken,
    );
    w = await warehouseOf(prisma);
    a = await createStructure(prisma, w.id, {
      zone: 'A',
      containers: ['01', '02'],
      racks: ['01', '02', '03'],
      color: '#2563EB',
    });
    await prisma.rack.update({
      where: { id: a.rackIds['A-01-03'] },
      data: { labelColor: '#DC2626' },
    });
    await prisma.rack.update({ where: { id: a.rackIds['A-02-02'] }, data: { isActive: false } });
    await prisma.rack.delete({ where: { id: a.rackIds['A-02-03'] } });
    await createStructure(prisma, w.id, { zone: 'B' });
    // Zona C con 501 racks (6 contenedores).
    big = await createStructure(prisma, w.id, { zone: 'C', containers: [], racks: [] });
    for (let c = 1; c <= 6; c++) {
      const code = String(c).padStart(2, '0');
      const container = await prisma.container.create({ data: { zoneId: big.zoneId, code } });
      const count = c === 6 ? 6 : 99;
      await prisma.rack.createMany({
        data: Array.from({ length: count }, (_, i) => {
          const rack = String(i + 1).padStart(2, '0');
          return {
            containerId: container.id,
            warehouseId: w.id,
            code: rack,
            locationCode: `C-${code}-${rack}`,
            capacityUnits: 10,
          };
        }),
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const labels = async (query: string) => {
    const res = await clerk.get(`/warehouses/${w.id}/labels?${query}`);
    expect(res.statusCode).toBe(200);
    return LocationLabelDto.array().parse(res.json());
  };
  const codes = (list: { locationCode: string }[]) => list.map((l) => l.locationCode);

  it('scope=rack: QR LOC:, color propio del rack y su nombre', async () => {
    const [label] = await labels(`scope=rack&ids=${a.rackIds['A-01-03']}`);
    expect(label).toEqual({
      rackId: a.rackIds['A-01-03'],
      locationCode: 'A-01-03',
      qrPayload: 'LOC:A-01-03',
      zoneCode: 'A',
      zoneName: 'Zona A',
      containerName: null,
      capacityUnits: 40,
      isStaging: false,
      colorHex: '#DC2626',
      colorName: 'Rojo',
    });
  });

  it('scope=container y zone: sus racks activos ordenados; el color sale de la zona', async () => {
    const container = await labels(`scope=container&ids=${a.containerIds['01']}`);
    expect(codes(container)).toEqual(['A-01-01', 'A-01-02', 'A-01-03']);
    expect(container[0]).toMatchObject({ colorHex: '#2563EB', colorName: 'Azul' });
    expect(codes(await labels(`scope=zone&ids=${a.zoneId}`))).toEqual([
      'A-01-01',
      'A-01-02',
      'A-01-03',
      'A-02-01',
    ]);
    const several = await labels(`scope=rack&ids=${a.rackIds['A-02-01']},${a.rackIds['A-01-01']}`);
    expect(codes(several)).toEqual(['A-01-01', 'A-02-01']);
  });

  it('scope=warehouse incluye staging; más de 500 → 400', async () => {
    await prisma.rack.updateMany({
      where: { container: { zoneId: big.zoneId } },
      data: { isActive: false },
    });
    const all = await labels('scope=warehouse');
    expect(codes(all)).toEqual([
      'A-01-01',
      'A-01-02',
      'A-01-03',
      'A-02-01',
      'B-01-01',
      'STG-01-01',
    ]);
    expect(all.at(-1)).toMatchObject({ isStaging: true, colorHex: null, colorName: null });
    expect(all.find((l) => l.locationCode === 'B-01-01')).toMatchObject({ colorHex: null });

    await prisma.rack.updateMany({
      where: { container: { zoneId: big.zoneId } },
      data: { isActive: true },
    });
    const res = await clerk.get(`/warehouses/${w.id}/labels?scope=zone&ids=${big.zoneId}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('sin ids fuera de "warehouse" → 400; sin warehouse.labels → 403', async () => {
    expect((await clerk.get(`/warehouses/${w.id}/labels?scope=zone`)).statusCode).toBe(400);
    const seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    const res = await seller.get(`/warehouses/${w.id}/labels?scope=warehouse`);
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toEqual({ permission: 'warehouse.labels' });
  });
});
