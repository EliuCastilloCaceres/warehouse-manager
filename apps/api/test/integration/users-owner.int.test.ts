import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

describe('protección del Propietario (T16)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let ownerToken: string;
  let ownerId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    adminToken = (await loginSeeded(app, prisma, 'admin')).accessToken;
    const owner = await loginSeeded(app, prisma, 'owner');
    ownerToken = owner.accessToken;
    ownerId = owner.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const ownerState = () =>
    prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      include: { branches: true, permissions: true },
    });

  it.each([
    ['PATCH', '', { fullName: 'Otro nombre' }],
    ['POST', '/deactivate', undefined],
    ['POST', '/reactivate', undefined],
    ['POST', '/reset-password', { mode: 'generate' }],
  ] as const)(
    'un ADMIN hace %s %s sobre owner → 403 sin cambios',
    async (method, path, payload) => {
      const before = await ownerState();
      const res = await app.inject({
        method,
        url: `/api/v1/users/${ownerId}${path}`,
        headers: bearer(adminToken),
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'USER_OWNER_PROTECTED',
        message: 'El Propietario solo puede ser modificado por él mismo.',
      });
      expect(await ownerState()).toEqual(before);
    },
  );

  it('owner edita su propio fullName → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${ownerId}`,
      headers: bearer(ownerToken),
      payload: { fullName: 'Eliu Castillo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: 'Eliu Castillo', role: { code: 'OWNER' } });
  });

  it('owner cambia su roleId o sus branchIds → 403 USER_SELF_CHANGE_FORBIDDEN', async () => {
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const s2 = await prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } });
    for (const payload of [{ roleId: admin.id }, { branchIds: [s2.id], defaultBranchId: s2.id }]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${ownerId}`,
        headers: bearer(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('USER_SELF_CHANGE_FORBIDDEN');
    }
    const owner = await ownerState();
    expect(owner.roleId).not.toBe(admin.id);
    expect(owner.branches.map((ub) => ub.branchId)).not.toContain(s2.id);
  });
});
