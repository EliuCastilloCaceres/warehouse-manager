import type { FastifyInstance } from 'fastify';
import type { AccessClaims } from '../../src/core/types.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login, refresh, withRefreshCookie } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('refresh', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    for (const username of ['vencido', 'desactivado', 'ventana', 'paralelo', 'origen']) {
      await createUser(prisma, { username });
    }
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const tokenRow = (cookie: string) =>
    prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(cookie) } });

  describe('T16', () => {
    it('sin cookie → 401 AUTH_REFRESH_INVALID', async () => {
      const res = await refresh(app);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_REFRESH_INVALID');
    });

    it('token vencido → 401', async () => {
      const { cookie } = await login(app, 'vencido');
      await prisma.refreshToken.update({
        where: { tokenHash: hashRefreshToken(cookie) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await refresh(app, cookie);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_REFRESH_INVALID');
    });

    it('usuario desactivado → 401 y su token queda revocado', async () => {
      const { cookie } = await login(app, 'desactivado');
      await prisma.user.update({ where: { username: 'desactivado' }, data: { isActive: false } });
      const res = await refresh(app, cookie);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_REFRESH_INVALID');
      expect((await tokenRow(cookie)).revokedAt).not.toBeNull();
    });

    it('ventana deslizante y permisos recalculados desde la BD', async () => {
      const { cookie, session } = await login(app, 'ventana');
      expect(session.me.permissions).not.toContain('pos.discount');

      const seller = await prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } });
      const discount = await prisma.permission.findUniqueOrThrow({
        where: { code: 'pos.discount' },
      });
      await prisma.rolePermission.create({
        data: { roleId: seller.id, permissionId: discount.id },
      });
      try {
        const before = Date.now();
        const res = await refresh(app, cookie);
        expect(res.statusCode).toBe(200);
        const claims = app.jwt.decode<AccessClaims>(res.json().accessToken)!;
        expect(claims.perms).toContain('pos.discount');

        const next = await prisma.refreshToken.findFirstOrThrow({
          where: { userId: session.me.user.id, revokedAt: null },
        });
        const expected = before + 7 * 86_400_000;
        expect(Math.abs(next.expiresAt.getTime() - expected)).toBeLessThan(5_000);
      } finally {
        await prisma.rolePermission.delete({
          where: { roleId_permissionId: { roleId: seller.id, permissionId: discount.id } },
        });
      }
    });
  });

  it('dos refresh en paralelo con la misma cookie → un 200 y un 401 REUSED (T17)', async () => {
    const { cookie } = await login(app, 'paralelo');
    const familyId = (await tokenRow(cookie)).familyId;

    const responses = await Promise.all([refresh(app, cookie), refresh(app, cookie)]);
    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 401]);
    expect(responses.find((r) => r.statusCode === 401)!.json().code).toBe('AUTH_REFRESH_REUSED');
    expect(await prisma.refreshToken.count({ where: { familyId, revokedAt: null } })).toBe(0);
  });

  it('Origin distinto de Host → 403; igual o sin Origin → se procesa (T18)', async () => {
    const host = { host: 'tienda.local' };
    const evil = { ...host, origin: 'https://otro-sitio.com' };
    const same = { ...host, origin: 'https://tienda.local' };
    const { accessToken, cookie } = await login(app, 'origen');

    const forbidden = await Promise.all([
      refresh(app, cookie, evil),
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { ...withRefreshCookie(cookie), ...evil },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { ...bearer(accessToken), ...evil },
        payload: { currentPassword: 'x', newPassword: 'nueva-clave-123' },
      }),
    ]);
    for (const res of forbidden) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('AUTH_ORIGIN_FORBIDDEN');
    }
    expect((await tokenRow(cookie)).revokedAt).toBeNull();

    const withOrigin = await refresh(app, cookie, same);
    expect(withOrigin.statusCode).toBe(200);
    const newCookie = withOrigin.cookies.find((c) => c.name === 'wm_rt')!.value;
    expect((await refresh(app, newCookie, host)).statusCode).toBe(200);
    const pwd = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { ...bearer(accessToken), ...same },
      payload: { currentPassword: 'mala-clave', newPassword: 'nueva-clave-123' },
    });
    expect(pwd.json().code).toBe('AUTH_PASSWORD_INCORRECT');
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: same });
    expect(logout.statusCode).toBe(204);
  });
});
