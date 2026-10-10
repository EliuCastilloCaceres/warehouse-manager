import { AuthSessionDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { createTestApp } from './helpers/app.js';
import { refreshCookieOf } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser, DEFAULT_PASSWORD } from './helpers/users.js';

describe('login', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'ana' });
    await createUser(prisma, { username: 'inactivo', isActive: false });
    await createUser(prisma, { username: 'limite' });
    await createUser(prisma, { username: 'otro' });
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const loginReq = (username: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password },
      headers: { 'user-agent': 'jest-agent' },
    });

  it('login correcto: sesión, cookie segura, hash en BD, lastLoginAt y audit (T12)', async () => {
    const res = await loginReq(' ANA ', DEFAULT_PASSWORD);

    expect(res.statusCode).toBe(200);
    const session = AuthSessionDto.parse(res.json());
    expect(session.me.user.username).toBe('ana');
    expect(session.expiresIn).toBe(15 * 60);

    const cookie = res.cookies.find((c) => c.name === 'wm_rt')!;
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/v1/auth', secure: true });
    expect(String(cookie.sameSite).toLowerCase()).toBe('strict');

    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenHash).toBe(hashRefreshToken(cookie.value));
    expect(tokens[0]!.tokenHash).not.toBe(cookie.value);
    expect(user.lastLoginAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.login', userId: user.id },
    });
    expect(audit.payload).toEqual({ userAgent: 'jest-agent' });
    expect(JSON.stringify(audit)).not.toContain(DEFAULT_PASSWORD);
  });

  it('contraseña incorrecta, usuario inexistente e inactivo → mismo 401 (T13)', async () => {
    const auditsBefore = await prisma.auditLog.count();
    const responses = await Promise.all([
      loginReq('ana', 'contraseña-mala'),
      loginReq('nadie', DEFAULT_PASSWORD),
      loginReq('inactivo', DEFAULT_PASSWORD),
    ]);
    const bodies = responses.map((r) => r.json());
    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(refreshCookieOf(res)).toBeUndefined();
    }
    expect(bodies.map((b) => b.code)).toEqual(Array(3).fill('AUTH_INVALID_CREDENTIALS'));
    expect(new Set(bodies.map((b) => b.message)).size).toBe(1);
    expect(bodies[0].message).toBe('Usuario o contraseña incorrectos');
    expect(await prisma.auditLog.count()).toBe(auditsBefore);
  });

  it('el 6.º intento en un minuto (misma ip y usuario) → 429; otro usuario sigue (T14)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await loginReq('limite', 'mala')).statusCode).toBe(401);
    }
    const blocked = await loginReq('limite', DEFAULT_PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');

    expect((await loginReq('otro', 'mala')).statusCode).toBe(401);
    expect((await loginReq('otro', DEFAULT_PASSWORD)).statusCode).toBe(200);
  });
});
