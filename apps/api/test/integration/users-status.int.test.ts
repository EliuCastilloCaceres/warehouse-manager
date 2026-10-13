import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded, refresh } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { DEFAULT_PASSWORD } from './helpers/users.js';

const READABLE = /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/;

describe('estado y contraseña (T18, T19)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    adminToken = (await loginSeeded(app, prisma, 'admin')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const action = (id: string, path: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/users/${id}/${path}`,
      headers: bearer(adminToken),
      ...(payload ? { payload } : {}),
    });
  const tryLogin = (username: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });

  describe('desactivar y reactivar (T18)', () => {
    it('desactiva, revoca sesiones e impide el login; es idempotente; reactivar lo devuelve', async () => {
      const { userId, cookie } = await createAndLogin(app, prisma, { username: 'baja' });

      const res = await action(userId, 'deactivate');
      expect(res.statusCode).toBe(200);
      expect(res.json().isActive).toBe(false);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      const renewed = await refresh(app, cookie);
      expect(renewed.statusCode).toBe(401);
      expect(renewed.json().code).toBe('AUTH_REFRESH_INVALID');
      expect((await tryLogin('baja', DEFAULT_PASSWORD)).statusCode).toBe(401);

      const again = await action(userId, 'deactivate');
      expect(again.statusCode).toBe(200);
      expect(again.json().isActive).toBe(false);
      expect(
        await prisma.auditLog.count({ where: { action: 'user.deactivate', entityId: userId } }),
      ).toBe(1);

      const back = await action(userId, 'reactivate');
      expect(back.statusCode).toBe(200);
      expect(back.json().isActive).toBe(true);
      expect((await tryLogin('baja', DEFAULT_PASSWORD)).statusCode).toBe(200);

      expect((await action(userId, 'reactivate')).statusCode).toBe(200);
      expect(
        await prisma.auditLog.count({ where: { action: 'user.reactivate', entityId: userId } }),
      ).toBe(1);
    });
  });

  describe('restablecer contraseña (T19)', () => {
    it.each([
      ['generate', { mode: 'generate' }],
      ['manual', { mode: 'manual', value: 'restablecida-1' }],
    ])(
      'modo %s: obliga a cambiarla, revoca sesiones y solo sirve la nueva',
      async (mode, payload) => {
        const username = `reset-${mode}`;
        const { userId, cookie } = await createAndLogin(app, prisma, { username });

        const res = await action(userId, 'reset-password', payload);
        expect(res.statusCode).toBe(200);
        const { generatedPassword } = res.json() as { generatedPassword: string | null };
        if (mode === 'generate') expect(generatedPassword).toMatch(READABLE);
        else expect(generatedPassword).toBeNull();

        const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(row.mustChangePassword).toBe(true);
        expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
        expect((await refresh(app, cookie)).statusCode).toBe(401);

        expect((await tryLogin(username, DEFAULT_PASSWORD)).statusCode).toBe(401);
        const newPassword = generatedPassword ?? 'restablecida-1';
        const login = await tryLogin(username, newPassword);
        expect(login.statusCode).toBe(200);
        expect(login.json().me.user.mustChangePassword).toBe(true);
      },
    );
  });
});
