import {
  PERMISSIONS,
  SYSTEM_ROLES,
  UserDetailDto,
  UserListItemDto,
  type PermissionGroupDto,
  type RoleWithPermissionsDto,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

interface Page {
  items: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
}

describe('lectura de usuarios, roles y permisos (T8, T9, T22)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let sellerToken: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    await createUser(prisma, {
      username: 'ana',
      fullName: 'Ana López',
      email: 'ana@tienda.mx',
      role: 'MANAGER',
    });
    await createUser(prisma, {
      username: 'bruno',
      fullName: 'Bruno Díaz',
      role: 'SELLER',
      branches: ['S2'],
      isActive: false,
    });
    await createUser(prisma, {
      username: 'carla',
      fullName: 'Carla Ruiz',
      email: 'cruiz@tienda.mx',
      role: 'WAREHOUSE_CLERK',
      branches: ['S1', 'S2'],
    });
    adminToken = (await loginSeeded(app, prisma, 'admin')).accessToken;
    managerToken = (await createAndLogin(app, prisma, { username: 'gerente', role: 'MANAGER' }))
      .accessToken;
    sellerToken = (await createAndLogin(app, prisma, { username: 'vende', role: 'SELLER' }))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const list = async (query: string, token = adminToken) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users${query}`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as Page;
  };
  const usernames = (page: Page) => page.items.map((item) => item.username);

  describe('GET /users (T8)', () => {
    it('ordena por fullName:asc por defecto y pagina', async () => {
      const all = await list('?pageSize=100');
      expect(all.total).toBe(7);
      expect(usernames(all)).toEqual([
        'admin', // Administrador
        'ana', // Ana López
        'bruno', // Bruno Díaz
        'carla', // Carla Ruiz
        'owner', // Propietario
        'gerente', // Usuario gerente
        'vende', // Usuario vende
      ]);

      const second = await list('?page=2&pageSize=2');
      expect(second).toMatchObject({ page: 2, pageSize: 2, total: 7 });
      expect(usernames(second)).toEqual(['bruno', 'carla']);
    });

    it('cada item cumple UserListItemDto y no trae passwordHash', async () => {
      const page = await list('?pageSize=100');
      for (const item of page.items) {
        expect(item).not.toHaveProperty('passwordHash');
        expect(UserListItemDto.safeParse(item).success).toBe(true);
      }
      const carla = page.items.find((item) => item.username === 'carla');
      expect(carla).toMatchObject({
        role: { code: 'WAREHOUSE_CLERK', name: 'Almacenista' },
        branches: [
          { code: 'S1', isDefault: true },
          { code: 'S2', isDefault: false },
        ],
      });
    });

    it.each([
      ['nombre', 'lópez', ['ana']],
      ['usuario', 'CARL', ['carla']],
      ['correo', 'tienda.mx', ['ana', 'carla']],
    ])('q busca por %s', async (_campo, q, expected) => {
      expect(usernames(await list(`?q=${encodeURIComponent(q)}`))).toEqual(expected);
    });

    it('filtra por isActive, roleId y branchId', async () => {
      expect(usernames(await list('?isActive=false'))).toEqual(['bruno']);
      expect((await list('?isActive=true')).total).toBe(6);

      const seller = await prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } });
      expect(usernames(await list(`?roleId=${seller.id}`))).toEqual(['bruno', 'vende']);

      const s2 = await prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } });
      expect(usernames(await list(`?branchId=${s2.id}`))).toEqual(['bruno', 'carla']);
    });

    it('acepta otro orden y rechaza uno no permitido', async () => {
      expect(usernames(await list('?sort=username:desc&pageSize=2'))).toEqual(['vende', 'owner']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users?sort=email:asc',
        headers: bearer(adminToken),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('un SELLER → 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: bearer(sellerToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'users.read' },
      });
    });
  });

  describe('GET /users/:id (T9)', () => {
    it('devuelve UserDetailDto con extras y permisos efectivos', async () => {
      const dora = await createUser(prisma, {
        username: 'dora',
        role: 'SELLER',
        extraPermissions: ['inventory.adjust'],
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${dora.id}`,
        headers: bearer(managerToken),
      });
      expect(res.statusCode).toBe(200);
      const body = UserDetailDto.parse(res.json());
      const seller = SYSTEM_ROLES.find((role) => role.code === 'SELLER')!;
      expect(body.extraPermissions).toEqual(['inventory.adjust']);
      expect(body.effectivePermissions).toEqual([...seller.permissions, 'inventory.adjust'].sort());
      expect(res.json()).not.toHaveProperty('passwordHash');
    });

    it('un id inexistente → 404 NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/00000000-0000-4000-8000-000000000000',
        headers: bearer(adminToken),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });
  });

  describe('GET /roles y GET /permissions (T22)', () => {
    const roles = async (token: string) => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/roles',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(200);
      return res.json() as RoleWithPermissionsDto[];
    };
    const assignable = (rows: RoleWithPermissionsDto[]) =>
      Object.fromEntries(rows.map((role) => [role.code, role.assignable]));

    it('devuelve los 5 roles en orden y con sus permisos', async () => {
      const rows = await roles(adminToken);
      expect(rows.map((role) => role.code)).toEqual(SYSTEM_ROLES.map((role) => role.code));
      for (const role of SYSTEM_ROLES) {
        const row = rows.find((r) => r.code === role.code)!;
        expect(row.permissions).toEqual([...role.permissions].sort());
        expect(row.isSystem).toBe(true);
      }
    });

    it('assignable depende de los permisos de quien pregunta', async () => {
      expect(assignable(await roles(managerToken))).toEqual({
        OWNER: false,
        ADMIN: false,
        MANAGER: true,
        SELLER: true,
        WAREHOUSE_CLERK: true,
      });
      expect(assignable(await roles(adminToken))).toMatchObject({ OWNER: false, ADMIN: true });
    });

    it('GET /permissions → 7 grupos y 25 permisos en orden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/permissions',
        headers: bearer(managerToken),
      });
      expect(res.statusCode).toBe(200);
      const groups = res.json() as PermissionGroupDto[];
      expect(groups.map((group) => group.module)).toEqual([
        'users',
        'products',
        'warehouse',
        'inventory',
        'pos',
        'reports',
        'settings',
      ]);
      const codes = groups.flatMap((group) => group.permissions.map((p) => p.code));
      expect(codes).toHaveLength(25);
      expect(codes).toEqual(PERMISSIONS.map((p) => p.code));
      expect(groups[0]!.permissions[0]).toEqual({
        code: 'users.read',
        description: 'Ver usuarios',
      });
    });
  });
});
