import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

describe('cambios sobre uno mismo (T17)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let adminId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const admin = await loginSeeded(app, prisma, 'admin');
    token = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: 'PATCH' | 'POST', path: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url: `/api/v1/users/${adminId}${path}`,
      headers: bearer(token),
      ...(payload ? { payload } : {}),
    });

  it.each([
    ['desactivarse', 'POST', '/deactivate', undefined],
    ['restablecer su contraseña', 'POST', '/reset-password', { mode: 'generate' }],
    ['cambiar sus extras', 'PATCH', '', { extraPermissions: [] }],
  ] as const)(
    'un ADMIN no puede %s → 403 USER_SELF_CHANGE_FORBIDDEN',
    async (_caso, method, path, payload) => {
      const res = await call(method, path, payload);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'USER_SELF_CHANGE_FORBIDDEN',
        message: 'No puedes cambiar tu propio rol, permisos, sucursales ni estado.',
      });
    },
  );

  it('un ADMIN no puede cambiar su rol (ni quitarse users.permissions)', async () => {
    const manager = await prisma.role.findUniqueOrThrow({ where: { code: 'MANAGER' } });
    const res = await call('PATCH', '', { roleId: manager.id });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('USER_SELF_CHANGE_FORBIDDEN');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: adminId },
      include: { role: true },
    });
    expect(admin).toMatchObject({ isActive: true, role: { code: 'ADMIN' } });
  });

  it('sí puede editar su teléfono → 200', async () => {
    const res = await call('PATCH', '', { phone: '555 222 3333' });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe('555 222 3333');
  });
});
