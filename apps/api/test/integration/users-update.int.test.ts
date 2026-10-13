import type { AuthSessionDto, UserDetailDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import type { AccessClaims } from '../../src/core/types.js';
import { createTestApp } from './helpers/app.js';
import {
  bearer,
  createAndLogin,
  login,
  loginSeeded,
  refresh,
  refreshCookieOf,
} from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('edición de usuarios (T14, T15, T20)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  const ids = { manager: '', s1: '', s2: '' };

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    ids.manager = (await prisma.role.findUniqueOrThrow({ where: { code: 'MANAGER' } })).id;
    ids.s1 = (await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } })).id;
    ids.s2 = (await prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } })).id;
    adminToken = (await loginSeeded(app, prisma, 'admin')).accessToken;
    managerToken = (await createAndLogin(app, prisma, { username: 'gerente', role: 'MANAGER' }))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const patch = (id: string, payload: unknown, token = adminToken) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${id}`,
      headers: bearer(token),
      payload: payload as Record<string, unknown>,
    });

  describe('PATCH /users/:id (T14)', () => {
    it('cambia datos, rol, sucursales y extras; descarta los extras del rol nuevo', async () => {
      const user = await createUser(prisma, {
        username: 'objetivo',
        role: 'SELLER',
        extraPermissions: ['inventory.adjust'],
      });
      const res = await patch(user.id, {
        fullName: 'Nombre Nuevo',
        email: 'nuevo@tienda.mx',
        phone: '555 123 4567',
        roleId: ids.manager,
        branchIds: [ids.s1, ids.s2],
        defaultBranchId: ids.s2,
        extraPermissions: ['inventory.adjust', 'users.permissions'],
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as UserDetailDto;
      expect(body).toMatchObject({
        fullName: 'Nombre Nuevo',
        email: 'nuevo@tienda.mx',
        phone: '555 123 4567',
        roleId: ids.manager,
        role: { code: 'MANAGER' },
        branches: [
          { code: 'S1', isDefault: false },
          { code: 'S2', isDefault: true },
        ],
        extraPermissions: ['users.permissions'],
      });
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(user.updatedAt.getTime());
      const extras = await prisma.userPermission.findMany({
        where: { userId: user.id },
        include: { permission: true },
      });
      expect(extras.map((e) => e.permission.code)).toEqual(['users.permissions']);
    });

    it('al cambiar solo el rol, los extras guardados que ya da el rol nuevo se quitan', async () => {
      const user = await createUser(prisma, {
        username: 'promovido',
        role: 'SELLER',
        extraPermissions: ['inventory.adjust'],
      });
      const res = await patch(user.id, { roleId: ids.manager });
      expect(res.statusCode).toBe(200);
      expect(res.json().extraPermissions).toEqual([]);
    });

    it('solo cambiar las sucursales también cambia updatedAt', async () => {
      const user = await createUser(prisma, { username: 'sucursales' });
      const res = await patch(user.id, { branchIds: [ids.s2], defaultBranchId: ids.s2 });
      expect(res.statusCode).toBe(200);
      expect(res.json().branches).toEqual([
        expect.objectContaining({ code: 'S2', isDefault: true }),
      ]);
      expect(new Date(res.json().updatedAt).getTime()).toBeGreaterThan(user.updatedAt.getTime());
    });

    it.each([
      ['con username', { username: 'otro' }],
      ['vacío', {}],
    ])('%s → 400 VALIDATION_ERROR', async (_caso, payload) => {
      const user = await createUser(prisma, { username: `invalido${Object.keys(payload).length}` });
      const res = await patch(user.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('defaultBranchId solo debe estar entre las sucursales actuales', async () => {
      const user = await createUser(prisma, { username: 'pred', branches: ['S1'] });
      const res = await patch(user.id, { defaultBranchId: ids.s2 });
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toEqual([expect.objectContaining({ path: 'defaultBranchId' })]);
    });
  });

  describe('alcance (T15)', () => {
    it('un MANAGER edita a un ADMIN → 403 USER_OUT_OF_SCOPE', async () => {
      const otherAdmin = await createUser(prisma, { username: 'admin2', role: 'ADMIN' });
      const res = await patch(otherAdmin.id, { phone: '555' }, managerToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('USER_OUT_OF_SCOPE');
    });

    it('un ADMIN edita a otro ADMIN → 200', async () => {
      const otherAdmin = await createUser(prisma, { username: 'admin3', role: 'ADMIN' });
      const res = await patch(otherAdmin.id, { phone: '555 999 0000' });
      expect(res.statusCode).toBe(200);
      expect(res.json().phone).toBe('555 999 0000');
    });

    it('un ADMIN agrega a un SELLER un extra que sí tiene → 200', async () => {
      const seller = await createUser(prisma, { username: 'vendedor' });
      const res = await patch(seller.id, { extraPermissions: ['pos.discount'] });
      expect(res.statusCode).toBe(200);
      expect(res.json().extraPermissions).toEqual(['pos.discount']);
    });

    it('un MANAGER cambia extras → 403 FORBIDDEN con users.permissions', async () => {
      const seller = await createUser(prisma, { username: 'vendedor2' });
      const res = await patch(seller.id, { extraPermissions: ['pos.discount'] }, managerToken);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'users.permissions' },
      });
    });
  });

  describe('sesiones abiertas (T20)', () => {
    it('agregar un extra no revoca y el siguiente refresh lo trae', async () => {
      const { userId, cookie } = await createAndLogin(app, prisma, { username: 'consesion' });
      const res = await patch(userId, { extraPermissions: ['inventory.adjust'] });
      expect(res.statusCode).toBe(200);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(1);

      const renewed = await refresh(app, cookie);
      expect(renewed.statusCode).toBe(200);
      expect(refreshCookieOf(renewed)).toBeDefined();
      const session = renewed.json() as AuthSessionDto;
      expect(session.me.permissions).toContain('inventory.adjust');
      const claims = app.jwt.decode<AccessClaims>(session.accessToken)!;
      expect(claims.perms).toContain('inventory.adjust');

      // Con la sesión nueva también sigue entrando.
      await expect(login(app, 'consesion')).resolves.toBeDefined();
    });
  });
});
