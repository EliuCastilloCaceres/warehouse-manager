import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { registerTestRoutes } from './helpers/testRoutes.js';
import { createUser } from './helpers/users.js';

describe('contexto de sucursal (T23)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let s1: string;
  let s2: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    s1 = (await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } })).id;
    s2 = (await prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } })).id;
    await createUser(prisma, { username: 'ambas', branches: ['S1', 'S2'], defaultBranch: 'S1' });
    await createUser(prisma, { username: 'solo-s2', branches: ['S2'], defaultBranch: null });
    await createUser(prisma, {
      username: 'sin-default',
      branches: ['S1', 'S2'],
      defaultBranch: null,
    });
    await createUser(prisma, { username: 'solo-s1', branches: ['S1'] });
    app = await createTestApp(prisma, { registerExtra: registerTestRoutes });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const branchOf = async (username: string, headers: Record<string, string> = {}) => {
    const { accessToken } = await login(app, username);
    return app.inject({
      method: 'GET',
      url: '/api/v1/test/branch',
      headers: { ...bearer(accessToken), ...headers },
    });
  };

  it('sin header → la sucursal por defecto', async () => {
    expect((await branchOf('ambas')).json()).toEqual({ branchId: s1 });
  });

  it('una sola sucursal sin default → esa', async () => {
    expect((await branchOf('solo-s2')).json()).toEqual({ branchId: s2 });
  });

  it('header permitido → esa', async () => {
    expect((await branchOf('ambas', { 'x-branch-id': s2 })).json()).toEqual({ branchId: s2 });
  });

  it('header no permitido → 403 BRANCH_FORBIDDEN', async () => {
    const res = await branchOf('solo-s1', { 'x-branch-id': s2 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('BRANCH_FORBIDDEN');
  });

  it('header que no es UUID → 400 VALIDATION_ERROR', async () => {
    const res = await branchOf('ambas', { 'x-branch-id': 'S1' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'x-branch-id' }],
    });
  });

  it('2 sucursales sin default y sin header → 400 BRANCH_REQUIRED', async () => {
    const res = await branchOf('sin-default');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BRANCH_REQUIRED');
  });
});
