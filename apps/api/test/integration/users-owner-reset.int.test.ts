import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../../src/core/password.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { NO_OWNER_MESSAGE, resetOwnerPassword } from '../../src/modules/users/ownerReset.js';
import { createTestApp } from './helpers/app.js';
import { loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

const READABLE = /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/;

describe('resetOwnerPassword (T24)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('genera una contraseña, obliga a cambiarla, cierra sesiones y lo audita sin actor', async () => {
    const { userId } = await loginSeeded(app, prisma, 'owner');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(1);

    const password = await resetOwnerPassword(prisma);

    expect(password).toMatch(READABLE);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await expect(verifyPassword(owner.passwordHash, password)).resolves.toBe(true);
    expect(owner.mustChangePassword).toBe(true);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    const logs = await prisma.auditLog.findMany({
      where: { action: 'user.owner_password_reset' },
    });
    expect(logs).toEqual([
      expect.objectContaining({ userId: null, entity: 'User', entityId: userId }),
    ]);
  });

  it('sin Propietario lanza el aviso y no escribe', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    const other = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.user.update({ where: { id: owner.id }, data: { roleId: other.id } });
    const audits = await prisma.auditLog.count();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });

    await expect(resetOwnerPassword(prisma)).rejects.toThrow(NO_OWNER_MESSAGE);
    expect(NO_OWNER_MESSAGE).toBe('No existe un Propietario. Ejecuta primero `pnpm db:seed`.');
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).toEqual(before);
  });
});
