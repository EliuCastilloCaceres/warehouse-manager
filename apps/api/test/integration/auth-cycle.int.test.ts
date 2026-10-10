import { AuthSessionDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { createTestApp } from './helpers/app.js';
import {
  bearer,
  fakeDateOnly,
  login,
  refresh,
  refreshCookieOf,
  withRefreshCookie,
} from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('ciclo completo de sesión (T15)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'ciclo' });
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    jest.useRealTimers();
    await app.close();
    await prisma.$disconnect();
  });

  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });

  it('login → me → expira → refresh → reutilización revoca la familia → logout', async () => {
    fakeDateOnly();
    const first = await login(app, 'ciclo');
    expect((await me(first.accessToken)).statusCode).toBe(200);

    // El access token vence a los 15 min.
    jest.setSystemTime(Date.now() + 16 * 60_000);
    const expired = await me(first.accessToken);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().code).toBe('UNAUTHENTICATED');

    // Refresh: token y cookie nuevos; el viejo queda revocado y enlazado.
    const rotated = await refresh(app, first.cookie);
    expect(rotated.statusCode).toBe(200);
    const second = AuthSessionDto.parse(rotated.json());
    const secondCookie = refreshCookieOf(rotated)!;
    expect(secondCookie).not.toBe(first.cookie);
    const old = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(first.cookie) },
    });
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedById).not.toBeNull();
    expect((await me(second.accessToken)).statusCode).toBe(200);

    // Reusar la cookie vieja revoca toda la familia (también la nueva).
    const reused = await refresh(app, first.cookie);
    expect(reused.statusCode).toBe(401);
    expect(reused.json().code).toBe('AUTH_REFRESH_REUSED');
    expect((await refresh(app, secondCookie)).statusCode).toBe(401);
    expect(
      await prisma.refreshToken.count({ where: { familyId: old.familyId, revokedAt: null } }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_reused' } })).toBe(1);

    // Nuevo login y logout: la cookie se limpia y ya no refresca.
    const third = await login(app, 'ciclo');
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: withRefreshCookie(third.cookie),
    });
    expect(logout.statusCode).toBe(204);
    const cleared = logout.cookies.find((c) => c.name === 'wm_rt')!;
    expect(cleared.value).toBe('');
    const afterLogout = await refresh(app, third.cookie);
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().code).toBe('AUTH_REFRESH_INVALID');
  });
});
