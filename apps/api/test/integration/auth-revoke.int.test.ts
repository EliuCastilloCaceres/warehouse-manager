import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('revokeAllForUser (T25)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'usuario-a' });
    await createUser(prisma, { username: 'usuario-b' });
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('revoca todas las familias de A y no toca las de B', async () => {
    await login(app, 'usuario-a');
    await login(app, 'usuario-a');
    await login(app, 'usuario-b');
    const a = await prisma.user.findUniqueOrThrow({ where: { username: 'usuario-a' } });
    const b = await prisma.user.findUniqueOrThrow({ where: { username: 'usuario-b' } });
    const families = await prisma.refreshToken.findMany({ where: { userId: a.id } });
    expect(new Set(families.map((t) => t.familyId)).size).toBe(2);

    const revoked = await app.authService.revokeAllForUser(a.id);

    expect(revoked).toBe(2);
    expect(await prisma.refreshToken.count({ where: { userId: a.id, revokedAt: null } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: b.id, revokedAt: null } })).toBe(1);
  });
});
