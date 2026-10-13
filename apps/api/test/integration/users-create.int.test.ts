import { PasswordPolicy, UserCreatedDto, type AuthSessionDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../../src/core/password.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

const READABLE = /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/;

describe('alta de usuarios (T10–T13, T21)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let sellerToken: string;
  const ids = { seller: '', admin: '', owner: '', s1: '', s2: '', s3: '' };

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const roles = await prisma.role.findMany();
    const roleId = (code: string) => roles.find((role) => role.code === code)!.id;
    ids.seller = roleId('SELLER');
    ids.admin = roleId('ADMIN');
    ids.owner = roleId('OWNER');
    const branches = await prisma.branch.findMany();
    ids.s1 = branches.find((b) => b.code === 'S1')!.id;
    ids.s2 = branches.find((b) => b.code === 'S2')!.id;
    ids.s3 = (
      await prisma.branch.create({ data: { code: 'S3', name: 'Cerrada', isActive: false } })
    ).id;
    adminToken = (await loginSeeded(app, prisma, 'admin')).accessToken;
    managerToken = (
      await createAndLogin(app, prisma, { username: 'gerente', role: 'MANAGER', branches: ['S1'] })
    ).accessToken;
    sellerToken = (await createAndLogin(app, prisma, { username: 'vende', role: 'SELLER' }))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    username: 'jperez',
    fullName: 'Juan Pérez',
    roleId: ids.seller,
    branchIds: [ids.s1],
    defaultBranchId: ids.s1,
    password: { mode: 'generate' },
    ...overrides,
  });
  const create = (payload: Record<string, unknown>, token = adminToken) =>
    app.inject({ method: 'POST', url: '/api/v1/users', headers: bearer(token), payload });

  describe('con contraseña generada (T10)', () => {
    it('crea el usuario, la contraseña verifica y obliga a cambiarla al entrar', async () => {
      const res = await create(input({ email: 'juan@tienda.mx', phone: '555 000 1111' }));
      expect(res.statusCode).toBe(201);
      const body = UserCreatedDto.parse(res.json());
      expect(body.generatedPassword).toMatch(READABLE);
      expect(PasswordPolicy.safeParse(body.generatedPassword).success).toBe(true);
      expect(body.user).toMatchObject({
        username: 'jperez',
        fullName: 'Juan Pérez',
        email: 'juan@tienda.mx',
        phone: '555 000 1111',
        isActive: true,
        mustChangePassword: true,
        role: { code: 'SELLER' },
        branches: [{ code: 'S1', isDefault: true }],
        extraPermissions: [],
      });

      const row = await prisma.user.findUniqueOrThrow({
        where: { username: 'jperez' },
        include: { branches: true },
      });
      expect(row.mustChangePassword).toBe(true);
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(verifyPassword(row.passwordHash, body.generatedPassword!)).resolves.toBe(true);
      expect(row.branches).toEqual([
        expect.objectContaining({ branchId: ids.s1, isDefault: true }),
      ]);

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'jperez', password: body.generatedPassword },
      });
      expect(login.statusCode).toBe(200);
      expect((login.json() as AuthSessionDto).me.user.mustChangePassword).toBe(true);
    });
  });

  describe('con contraseña escrita (T11)', () => {
    it('devuelve generatedPassword null y guarda la contraseña enviada', async () => {
      const res = await create(
        input({ username: 'mlopez', password: { mode: 'manual', value: 'escrita-123' } }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().generatedPassword).toBeNull();
      const row = await prisma.user.findUniqueOrThrow({ where: { username: 'mlopez' } });
      await expect(verifyPassword(row.passwordHash, 'escrita-123')).resolves.toBe(true);
      expect(row.mustChangePassword).toBe(true);
    });

    it('una contraseña de 7 caracteres → 400 en password.value', async () => {
      const res = await create(
        input({ username: 'corta', password: { mode: 'manual', value: '1234567' } }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ path: 'password.value' })],
      });
    });
  });

  describe('referencias y unicidad (T12)', () => {
    const counts = async () => ({
      users: await prisma.user.count(),
      audits: await prisma.auditLog.count(),
      branches: await prisma.userBranch.count(),
    });

    it('username duplicado → 409 CONFLICT con target username', async () => {
      await createUser(prisma, { username: 'repetido' });
      const before = await counts();
      const res = await create(input({ username: 'Repetido' }));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'CONFLICT', message: 'Este usuario ya existe.' });
      expect(res.json().details.target).toContain('username');
      expect(await counts()).toEqual(before);
    });

    it.each([
      [
        'roleId inexistente',
        () => input({ username: 'nuevo', roleId: '00000000-0000-4000-8000-000000000000' }),
        'roleId',
      ],
      [
        'sucursal inactiva',
        () => input({ username: 'nuevo', branchIds: [ids.s3], defaultBranchId: ids.s3 }),
        'branchIds',
      ],
    ])('%s → 400 sin escribir', async (_caso, payload, path) => {
      const before = await counts();
      const res = await create(payload());
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ path })],
      });
      expect(await counts()).toEqual(before);
    });
  });

  describe('escalada al crear (T13)', () => {
    it('un MANAGER crea un ADMIN → 403 PERMISSION_ESCALATION', async () => {
      const res = await create(input({ username: 'nuevoadmin', roleId: ids.admin }), managerToken);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'PERMISSION_ESCALATION',
        details: { permissions: ['users.permissions'] },
      });
    });

    it('un MANAGER envía extras → 403 FORBIDDEN con users.permissions', async () => {
      const res = await create(
        input({ username: 'conextras', extraPermissions: ['inventory.adjust'] }),
        managerToken,
      );
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'users.permissions' },
      });
    });

    it('un ADMIN crea con rol OWNER → 403 USER_OWNER_PROTECTED', async () => {
      const res = await create(input({ username: 'otrodueno', roleId: ids.owner }));
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('USER_OWNER_PROTECTED');
    });

    it('una sucursal fuera de los claims del actor → 403 BRANCH_FORBIDDEN', async () => {
      const res = await create(
        input({ username: 'des2', branchIds: [ids.s1, ids.s2], defaultBranchId: ids.s1 }),
        managerToken,
      );
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('BRANCH_FORBIDDEN');
      expect(await prisma.user.count({ where: { username: 'des2' } })).toBe(0);
    });

    it('un ADMIN con users.permissions sí asigna extras; los que da el rol se descartan', async () => {
      const res = await create(
        input({ username: 'extras', extraPermissions: ['inventory.adjust', 'pos.sell'] }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().user.extraPermissions).toEqual(['inventory.adjust']);
    });
  });

  describe('permiso del catálogo que falta en la BD', () => {
    it('responde 500 con el aviso del seed y no escribe', async () => {
      await prisma.permission.delete({ where: { code: 'reports.sales.all_users' } });
      const users = await prisma.user.count();
      const res = await create(
        input({ username: 'sinseed', extraPermissions: ['reports.sales.all_users'] }),
      );
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        code: 'INTERNAL_ERROR',
        message:
          'Faltan permisos en la base de datos (reports.sales.all_users); ejecuta `pnpm db:seed`.',
        details: { permissions: ['reports.sales.all_users'] },
      });
      expect(await prisma.user.count()).toBe(users);
    });
  });

  describe('GET /users/suggest-username (T21)', () => {
    const suggest = async (fullName: string, token = adminToken) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/users/suggest-username?fullName=${encodeURIComponent(fullName)}`,
        headers: bearer(token),
      });

    it('agrega el primer sufijo libre', async () => {
      await prisma.user.deleteMany({ where: { username: { startsWith: 'jgarcia' } } });
      expect((await suggest('Juana García')).json()).toEqual({ username: 'jgarcia' });
      await createUser(prisma, { username: 'jgarcia' });
      expect((await suggest('Juana García')).json()).toEqual({ username: 'jgarcia2' });
      await createUser(prisma, { username: 'jgarcia2' });
      expect((await suggest('Juana García')).json()).toEqual({ username: 'jgarcia3' });
    });

    it('con jperez existente sugiere jperez2', async () => {
      expect((await suggest('Juan Pérez')).json()).toEqual({ username: 'jperez2' });
    });

    it('recorta la base para que el sufijo quepa en 30', async () => {
      const long = `${'x'.repeat(30)}`;
      await createUser(prisma, { username: long });
      expect((await suggest(long)).json()).toEqual({ username: `${'x'.repeat(29)}2` });
    });

    it('fullName=Lu → null; un SELLER → 403', async () => {
      expect((await suggest('Lu')).json()).toEqual({ username: null });
      const res = await suggest('Juan Pérez', sellerToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });
  });
});
