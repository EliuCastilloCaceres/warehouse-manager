import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { loginSeeded } from './helpers/auth.js';
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

describe('dos usuarios ubican en el mismo rack a la vez (T26)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let rackId: string;
  let variants: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const session = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, session.accessToken);
    const w = await warehouseOf(prisma);
    rackId = (await createStructure(prisma, w.id, { zone: 'A', capacity: 10 })).rackIds['A-01-01']!;
    variants = (await createProduct(prisma, 'CON0001', ['NEG', 'CAF', 'BLA'])).variantIds;
    // 7 de 10: quedan 3 libres.
    await putStock(prisma, {
      variantId: variants[2]!,
      rackId,
      quantity: 7,
      userId: session.userId,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('uno responde 200 y el otro 409 RACK_CAPACITY_EXCEEDED', async () => {
    const results = await Promise.all(
      [variants[0], variants[1]].map((variantId) =>
        admin.post('/inventory/putaway', { variantId, rackId, quantity: 2, source: 'NEW' }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('RACK_CAPACITY_EXCEEDED');
    const occupied = await prisma.stockLocation.aggregate({
      where: { rackId },
      _sum: { quantity: true },
    });
    expect(occupied._sum.quantity).toBe(9); // capacidad − 1
  });
});
