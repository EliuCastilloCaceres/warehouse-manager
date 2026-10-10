import { MeDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('GET /auth/me (T24)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'yo', branches: ['S1', 'S2'], defaultBranch: 'S1' });
    await createUser(prisma, { username: 'se-va' });
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });

  it('devuelve el MeDto leído de la BD, con un permiso extra agregado después del login', async () => {
    const { accessToken } = await login(app, 'yo');
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'yo' } });
    const extra = await prisma.permission.findUniqueOrThrow({ where: { code: 'pos.discount' } });
    await prisma.userPermission.create({ data: { userId: user.id, permissionId: extra.id } });

    const res = await me(accessToken);
    expect(res.statusCode).toBe(200);
    const body = MeDto.parse(res.json());
    expect(body.user).toMatchObject({ username: 'yo', role: { code: 'SELLER', name: 'Vendedor' } });
    expect(body.permissions).toContain('pos.discount');
    expect(body.permissions).toHaveLength(9);
    expect(body.branches.map((b) => [b.code, b.isDefault])).toEqual([
      ['S1', true],
      ['S2', false],
    ]);
  });

  it('usuario desactivado con un token aún vigente → 401', async () => {
    const { accessToken } = await login(app, 'se-va');
    await prisma.user.update({ where: { username: 'se-va' }, data: { isActive: false } });
    const res = await me(accessToken);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });
});
