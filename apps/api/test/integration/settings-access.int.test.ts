import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

interface OpenApiOperation {
  tags?: string[];
  security?: unknown[];
}

describe('acceso a Ajustes (T14)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let s1: string;
  let s1c1: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const register = await prisma.cashRegister.findFirstOrThrow({
      where: { code: 'C1', branch: { code: 'S1' } },
    });
    s1 = register.branchId;
    s1c1 = register.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const branchRoutes = () => [
    { method: 'GET' as const, url: `/api/v1/branches/${s1}` },
    { method: 'PATCH' as const, url: `/api/v1/branches/${s1}`, payload: { name: 'X' } },
  ];
  const registerRoutes = () => [
    { method: 'GET' as const, url: '/api/v1/cash-registers' },
    { method: 'GET' as const, url: `/api/v1/cash-registers/${s1c1}` },
    { method: 'PATCH' as const, url: `/api/v1/cash-registers/${s1c1}`, payload: { name: 'X' } },
  ];

  it.each([
    ['settings.branch', 'settings.registers', registerRoutes],
    ['settings.registers', 'settings.branch', branchRoutes],
  ] as const)('con solo %s → 403 en las rutas de %s', async (has, lacks, routes) => {
    const { accessToken } = await createAndLogin(app, prisma, {
      username: `solo-${has.replace('.', '-')}`,
      extraPermissions: [has],
    });
    for (const route of routes()) {
      const res = await app.inject({ ...route, headers: bearer(accessToken) });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: lacks } });
    }
  });

  it('Swagger agrupa las 5 rutas bajo el tag settings con security', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/api/docs/json' })).json() as {
      paths: Record<string, Record<string, OpenApiOperation>>;
    };
    const settings = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) => op.tags?.includes('settings'))
        .map(([method, op]) => ({ route: `${method.toUpperCase()} ${path}`, op })),
    );
    expect(settings.map((s) => s.route).sort()).toEqual([
      'GET /api/v1/branches/{id}',
      'GET /api/v1/cash-registers/',
      'GET /api/v1/cash-registers/{id}',
      'PATCH /api/v1/branches/{id}',
      'PATCH /api/v1/cash-registers/{id}',
    ]);
    for (const { op } of settings) expect(op.security).toEqual([{ bearerAuth: [] }]);
  });
});
