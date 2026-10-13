import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

describe('audit de usuarios (T23)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const admin = await loginSeeded(app, prisma, 'admin');
    adminToken = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: bearer(adminToken), ...(payload ? { payload } : {}) });

  it('cada acción deja su AuditLog, sin contraseñas', async () => {
    const seller = await prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } });
    const s1 = await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } });
    const manualPassword = 'escrita-por-admin';

    const created = await call('POST', '/api/v1/users', {
      username: 'auditado',
      fullName: 'Usuario Auditado',
      roleId: seller.id,
      branchIds: [s1.id],
      defaultBranchId: s1.id,
      extraPermissions: ['inventory.adjust'],
      password: { mode: 'generate' },
    });
    expect(created.statusCode).toBe(201);
    const { user, generatedPassword } = created.json() as {
      user: { id: string };
      generatedPassword: string;
    };
    const base = `/api/v1/users/${user.id}`;

    expect(
      (await call('PATCH', base, { phone: '555 444 5555', fullName: 'Usuario Auditado' }))
        .statusCode,
    ).toBe(200);
    expect((await call('POST', `${base}/deactivate`)).statusCode).toBe(200);
    expect((await call('POST', `${base}/reactivate`)).statusCode).toBe(200);
    const reset = await call('POST', `${base}/reset-password`, { mode: 'generate' });
    expect(reset.statusCode).toBe(200);
    const resetGenerated = reset.json().generatedPassword as string;
    expect(
      (await call('POST', `${base}/reset-password`, { mode: 'manual', value: manualPassword }))
        .statusCode,
    ).toBe(200);

    const logs = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: user.id } });
    expect(logs.map((log) => log.action).sort()).toEqual([
      'user.create',
      'user.deactivate',
      'user.password_reset',
      'user.password_reset',
      'user.reactivate',
      'user.update',
    ]);
    const payloadOf = (action: string) =>
      logs.filter((log) => log.action === action).map((log) => log.payload);
    for (const log of logs) {
      expect(log).toMatchObject({ userId: adminId, entity: 'User', entityId: user.id });
      expect(log.ip).toEqual(expect.any(String));
      const payload = JSON.stringify(log.payload ?? {});
      for (const secret of [generatedPassword, resetGenerated, manualPassword]) {
        expect(payload).not.toContain(secret);
      }
    }

    expect(payloadOf('user.create')).toEqual([
      {
        roleCode: 'SELLER',
        branchIds: [s1.id],
        extraPermissions: ['inventory.adjust'],
        passwordMode: 'generate',
      },
    ]);
    // Solo el campo que cambió (el nombre se envió igual).
    expect(payloadOf('user.update')).toEqual([{ phone: { from: null, to: '555 444 5555' } }]);
    expect(payloadOf('user.password_reset')).toEqual(
      expect.arrayContaining([{ passwordMode: 'generate' }, { passwordMode: 'manual' }]),
    );
  });
});
