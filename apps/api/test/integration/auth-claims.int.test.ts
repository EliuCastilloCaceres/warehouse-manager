import type { FastifyInstance } from 'fastify';
import type { AccessClaims } from '../../src/core/types.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { ADMIN_PASSWORD, OWNER_PASSWORD, resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

describe('claims del access token (T22)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let activeBranchIds: string[];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await prisma.branch.create({ data: { code: 'S9', name: 'Cerrada', isActive: false } });
    activeBranchIds = (await prisma.branch.findMany({ where: { isActive: true } }))
      .map((b) => b.id)
      .sort();
    await createUser(prisma, {
      username: 'vendedor-extra',
      role: 'SELLER',
      branches: ['S1', 'S2', 'S9'],
      defaultBranch: 'S2',
      extraPermissions: ['pos.discount'],
      mustChangePassword: true,
    });
    app = await createTestApp(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const claimsOf = async (username: string, password?: string) =>
    app.jwt.decode<AccessClaims>((await login(app, username, password)).accessToken)!;

  it.each([
    ['owner', OWNER_PASSWORD, 'OWNER'],
    ['admin', ADMIN_PASSWORD, 'ADMIN'],
  ])('%s recibe todas las sucursales activas', async (username, password, role) => {
    const claims = await claimsOf(username, password);
    expect(claims.role).toBe(role);
    expect([...claims.branchIds].sort()).toEqual(activeBranchIds);
    expect(claims.perms).toHaveLength(25);
    const s1 = await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } });
    expect(claims.defaultBranchId).toBe(s1.id);
    expect(claims.mcp).toBe(true);
  });

  it('SELLER con un permiso extra: 8 + 1, sin la sucursal inactiva, default y mcp', async () => {
    const claims = await claimsOf('vendedor-extra');
    expect(claims.perms).toHaveLength(9);
    expect(claims.perms).toContain('pos.discount');
    expect(claims.perms).toEqual([...claims.perms].sort());

    const [s2, s9] = await Promise.all([
      prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } }),
      prisma.branch.findUniqueOrThrow({ where: { code: 'S9' } }),
    ]);
    expect(claims.branchIds).toHaveLength(2);
    expect(claims.branchIds).not.toContain(s9.id);
    expect(claims.defaultBranchId).toBe(s2.id);
    expect(claims.mcp).toBe(true);
  });
});
