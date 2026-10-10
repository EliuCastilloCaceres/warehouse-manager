import { AuthSessionDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../../src/core/password.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login, refresh, refreshCookieOf, withRefreshCookie } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { registerTestRoutes } from './helpers/testRoutes.js';
import { createUser, DEFAULT_PASSWORD } from './helpers/users.js';

describe('cambio obligatorio y cambio de contraseña', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'nuevo', role: 'MANAGER', mustChangePassword: true });
    await createUser(prisma, { username: 'cambia', role: 'MANAGER', mustChangePassword: true });
    app = await createTestApp(prisma, { registerExtra: registerTestRoutes });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const changePassword = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer(token),
      payload,
    });

  it('con mustChangePassword solo se permiten me, cambio de contraseña y logout (T20)', async () => {
    const { accessToken, cookie } = await login(app, 'nuevo');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.mustChangePassword).toBe(true);

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/v1/test/protected',
      headers: bearer(accessToken),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: withRefreshCookie(cookie),
    });
    expect(logout.statusCode).toBe(204);
  });

  it('cambio de contraseña: validaciones, sesión nueva y las demás cerradas (T21)', async () => {
    const current = await login(app, 'cambia');
    const other = await login(app, 'cambia');

    const wrong = await changePassword(current.accessToken, {
      currentPassword: 'no-es-la-actual',
      newPassword: 'nueva-clave-123',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('AUTH_PASSWORD_INCORRECT');

    const same = await changePassword(current.accessToken, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: DEFAULT_PASSWORD,
    });
    expect(same.statusCode).toBe(400);
    expect(same.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'newPassword' }],
    });

    const ok = await changePassword(current.accessToken, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'nueva-clave-123',
    });
    expect(ok.statusCode).toBe(200);
    const session = AuthSessionDto.parse(ok.json());
    expect(session.me.user.mustChangePassword).toBe(false);
    const newCookie = refreshCookieOf(ok)!;

    expect((await refresh(app, other.cookie)).statusCode).toBe(401);
    expect((await refresh(app, newCookie)).statusCode).toBe(200);
    const protectedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/test/protected',
      headers: bearer(session.accessToken),
    });
    expect(protectedRes.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'cambia' } });
    await expect(verifyPassword(user.passwordHash, 'nueva-clave-123')).resolves.toBe(true);
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.password_change', userId: user.id } }),
    ).toBe(1);
  });
});
