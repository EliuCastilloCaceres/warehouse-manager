import type { TicketBranchDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createTestClient } from './helpers/db.js';
import { expectStatus, type PosScenario, setupPos } from './helpers/pos.js';

const ID = '9a8b7c6d-5e4f-4a3b-8c2d-000000000001';

interface OpenApiDoc {
  paths: Record<string, Record<string, { tags?: string[]; security?: unknown }>>;
}

describe('acceso al POS (T21)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pos: PosScenario;

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    pos = await setupPos(prisma, app);
    await prisma.branch.update({
      where: { id: pos.s1.branchId },
      data: { ticketFooterMessage: 'Gracias por su compra', promoQrText: 'DESC10' },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('el Vendedor obtiene los datos de ticket sin settings.branch', async () => {
    const branch = expectStatus<TicketBranchDto>(await pos.ana.get('/pos/branch'), 200);
    expect(branch).toEqual({
      code: 'S1',
      name: expect.any(String),
      legalName: null,
      taxId: null,
      address: null,
      phone: null,
      logoUrl: null,
      ticketHeader: null,
      ticketFooterMessage: 'Gracias por su compra',
      promoQrText: 'DESC10',
      promoQrCaption: null,
      timezone: 'America/Mexico_City',
      currency: 'MXN',
    });
    expect((await pos.ana.get('/branches/' + pos.s1.branchId)).statusCode).toBe(403);
  });

  // Con bodies válidos: la validación corre antes que el permiso (preHandler). Toda fila lleva
  // 3 valores; con 2, Jest pasaría `done` como tercer argumento.
  it.each<[string, string, object | null]>([
    ['GET', '/pos/branch', null],
    ['GET', '/pos/lookup?code=ZAP0101', null],
    ['GET', '/pos/cash-registers', null],
    ['GET', `/pos/cash-sessions/${ID}`, null],
    ['GET', `/pos/cash-sessions/${ID}/sales`, null],
    ['GET', '/pos/carts', null],
    ['POST', '/pos/carts', {}],
    ['GET', `/pos/carts/${ID}`, null],
    ['PATCH', `/pos/carts/${ID}`, { label: 'x' }],
    ['POST', `/pos/carts/${ID}/suspend`, {}],
    ['POST', `/pos/carts/${ID}/resume`, {}],
    ['POST', `/pos/carts/${ID}/discard`, { releaseTo: 'RACK' }],
    ['POST', `/pos/carts/${ID}/items`, { variantId: ID, sourceRackId: ID, quantity: 1 }],
    ['PATCH', `/pos/carts/${ID}/items/${ID}`, { quantity: 1 }],
    ['DELETE', `/pos/carts/${ID}/items/${ID}`, null],
    ['POST', `/pos/carts/${ID}/checkout`, { cashSessionId: ID, payments: [], verifiedUnits: 0 }],
    ['GET', `/pos/sales/${ID}/ticket`, null],
  ])('sin pos.sell, %s %s → 403', async (method, url, body) => {
    const res =
      method === 'GET'
        ? await pos.clerk.get(url)
        : method === 'DELETE'
          ? await pos.clerk.delete(url)
          : method === 'PATCH'
            ? await pos.clerk.patch(url, body ?? {})
            : await pos.clerk.post(url, body ?? {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'pos.sell' } });
  });

  it('Swagger agrupa las 22 rutas bajo el tag pos, con seguridad Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = res.json() as OpenApiDoc;
    const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ path, method, op })),
    );
    const posOps = operations.filter(({ op }) => op.tags?.includes('pos'));
    expect(posOps).toHaveLength(22);
    expect(posOps.every(({ path }) => path.startsWith('/api/v1/pos/'))).toBe(true);
    for (const { op } of posOps) expect(op.security).toEqual([{ bearerAuth: [] }]);
  });
});
