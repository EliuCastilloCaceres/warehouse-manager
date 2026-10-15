import { SuggestionsDto } from '@warehouse-manager/shared';
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

describe('sugerencias de ubicación (T19)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let variantId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    const w = await warehouseOf(prisma);

    // Zona A (prioridad 1) y B (prioridad 0 = preferida), racks de capacidad 10.
    const a = await createStructure(prisma, w.id, {
      zone: 'A',
      racks: ['01', '02', '03', '04'],
      capacity: 10,
      priority: 1,
    });
    const b = await createStructure(prisma, w.id, {
      zone: 'B',
      racks: ['01', '02', '03'],
      capacity: 10,
    });
    await createStructure(prisma, w.id, {
      zone: 'C',
      racks: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
      capacity: 5,
      priority: 5,
    });
    await prisma.rack.update({ where: { id: a.rackIds['A-01-04'] }, data: { isActive: false } });

    const [own, sibling] = (await createProduct(prisma, 'SUG0001', ['NEG', 'CAF'])).variantIds;
    const [other] = (await createProduct(prisma, 'SUG0002')).variantIds;
    variantId = own!;
    const put = (variant: string, rackId: string, quantity: number) =>
      putStock(prisma, { variantId: variant, rackId, quantity, userId: session.userId });
    await put(own!, a.rackIds['A-01-01']!, 2); // misma variante · libres 8
    await put(sibling!, a.rackIds['A-01-02']!, 3); // mismo producto · libres 7
    await put(other!, a.rackIds['A-01-03']!, 10); // lleno
    await put(other!, b.rackIds['B-01-01']!, 1); // libres 9
    await put(own!, w.staging.rackId, 5); // staging: nunca se sugiere
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const suggest = async (quantity: number) => {
    const res = await admin.get(
      `/inventory/suggest-locations?variantId=${variantId}&quantity=${quantity}`,
    );
    expect(res.statusCode).toBe(200);
    return SuggestionsDto.parse(res.json());
  };

  it('misma variante, mismo producto y luego por prioridad de zona y espacio libre', async () => {
    const result = await suggest(3);
    expect(result.fitsAll).toBe(true);
    expect(result.suggestions.map((s) => [s.locationCode, s.reason, s.free])).toEqual([
      ['A-01-01', 'SAME_VARIANT', 8],
      ['A-01-02', 'SAME_PRODUCT', 7],
      ['B-01-02', 'FREE_SPACE', 10],
      ['B-01-03', 'FREE_SPACE', 10],
      ['B-01-01', 'FREE_SPACE', 9],
      ['C-01-01', 'FREE_SPACE', 5],
      ['C-01-02', 'FREE_SPACE', 5],
      ['C-01-03', 'FREE_SPACE', 5],
      ['C-01-04', 'FREE_SPACE', 5],
      ['C-01-05', 'FREE_SPACE', 5],
    ]);
    expect(result.suggestions[0]).toMatchObject({ zoneName: 'Zona A', level: 'green' });
  });

  it('excluye racks sin espacio suficiente, llenos, inactivos y el staging', async () => {
    const result = await suggest(8);
    expect(result.suggestions.map((s) => s.locationCode)).toEqual([
      'A-01-01',
      'B-01-02',
      'B-01-03',
      'B-01-01',
    ]);
    const all = (await suggest(1)).suggestions.map((s) => s.locationCode);
    expect(all).toHaveLength(10);
    expect(all).not.toEqual(expect.arrayContaining(['A-01-03', 'A-01-04', 'STG-01-01']));
  });

  it('si ninguno alcanza → fitsAll: false con los de más espacio', async () => {
    const result = await suggest(100);
    expect(result.fitsAll).toBe(false);
    expect(result.suggestions.map((s) => [s.locationCode, s.free])).toEqual([
      ['B-01-02', 10],
      ['B-01-03', 10],
      ['B-01-01', 9],
      ['A-01-01', 8],
      ['A-01-02', 7],
      ['C-01-01', 5],
      ['C-01-02', 5],
      ['C-01-03', 5],
      ['C-01-04', 5],
      ['C-01-05', 5],
    ]);
  });

  it('sin inventory.putaway → 403; variante inexistente → 404', async () => {
    const seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    const res = await seller.get(`/inventory/suggest-locations?variantId=${variantId}&quantity=1`);
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toEqual({ permission: 'inventory.putaway' });
    const missing = await admin.get(
      '/inventory/suggest-locations?variantId=00000000-0000-4000-8000-000000000000&quantity=1',
    );
    expect(missing.statusCode).toBe(404);
  });
});
