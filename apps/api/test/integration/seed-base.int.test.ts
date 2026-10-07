import { SYSTEM_ROLES } from '@warehouse-manager/shared';
import { seedBase } from '../../prisma/seed/base.js';
import { formatSummary } from '../../prisma/seed/summary.js';
import { verifyPassword } from '../../src/core/password.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';

const OPTIONS = { ownerPassword: 'clave-owner-1', adminPassword: 'clave-admin-1' };

async function counts(prisma: PrismaClient) {
  return {
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    rolePermissions: await prisma.rolePermission.count(),
    branches: await prisma.branch.count(),
    counters: await prisma.branchCounter.count(),
    registers: await prisma.cashRegister.count(),
    warehouses: await prisma.warehouse.count(),
    zones: await prisma.zone.count(),
    containers: await prisma.container.count(),
    racks: await prisma.rack.count(),
    users: await prisma.user.count(),
    userBranches: await prisma.userBranch.count(),
    categories: await prisma.category.count(),
  };
}

async function ids(prisma: PrismaClient) {
  const pick = async (rows: Promise<{ id: string }[]>) => (await rows).map((r) => r.id).sort();
  return {
    permissions: await pick(prisma.permission.findMany({ select: { id: true } })),
    roles: await pick(prisma.role.findMany({ select: { id: true } })),
    branches: await pick(prisma.branch.findMany({ select: { id: true } })),
    users: await pick(prisma.user.findMany({ select: { id: true } })),
    racks: await pick(prisma.rack.findMany({ select: { id: true } })),
    categories: await pick(prisma.category.findMany({ select: { id: true } })),
  };
}

async function rolePermissionCodes(prisma: PrismaClient, roleCode: string) {
  const rows = await prisma.rolePermission.findMany({
    where: { role: { code: roleCode } },
    select: { permission: { select: { code: true } } },
  });
  return rows.map((r) => r.permission.code).sort();
}

describe('seed base', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sobre una BD vacía crea permisos, roles, sucursales, usuarios y categorías (T21)', async () => {
    const summary = await seedBase(prisma, OPTIONS);

    expect(await prisma.permission.count()).toBe(25);
    for (const role of SYSTEM_ROLES) {
      const row = await prisma.role.findUniqueOrThrow({ where: { code: role.code } });
      expect(row).toMatchObject({ name: role.name, isSystem: true });
      expect(await rolePermissionCodes(prisma, role.code)).toEqual([...role.permissions].sort());
    }
    expect(SYSTEM_ROLES.map((r) => r.permissions.length)).toEqual([25, 25, 24, 8, 8]);

    for (const code of ['S1', 'S2']) {
      const branch = await prisma.branch.findUniqueOrThrow({
        where: { code },
        include: {
          counters: true,
          cashRegisters: { orderBy: { code: 'asc' } },
          warehouses: {
            include: { zones: { include: { containers: { include: { racks: true } } } } },
          },
        },
      });
      expect(branch).toMatchObject({
        name: code === 'S1' ? 'Sucursal 1' : 'Sucursal 2',
        currency: 'MXN',
        taxRateBp: 1600,
        pricesIncludeTax: true,
        lowStockThreshold: 2,
        timezone: 'America/Mexico_City',
      });
      expect(branch.counters).toEqual([expect.objectContaining({ key: 'SALE_FOLIO', value: 0 })]);
      expect(branch.cashRegisters.map((r) => [r.code, r.name])).toEqual([
        ['C1', 'Caja 1'],
        ['C2', 'Caja 2'],
      ]);
      expect(branch.warehouses).toHaveLength(1);
      const [warehouse] = branch.warehouses;
      expect(warehouse).toMatchObject({ code: 'ALM1', name: 'Almacén principal' });
      expect(warehouse!.zones).toHaveLength(1);
      const [zone] = warehouse!.zones;
      expect(zone).toMatchObject({ code: 'STG', isStaging: true });
      expect(zone!.containers.map((c) => c.code)).toEqual(['01']);
      expect(zone!.containers[0]!.racks).toEqual([
        expect.objectContaining({ code: '01', locationCode: 'STG-01-01', capacityUnits: 0 }),
      ]);
    }
    expect(await counts(prisma)).toMatchObject({
      branches: 2,
      registers: 4,
      warehouses: 2,
      racks: 2,
    });

    const s1 = await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } });
    for (const [username, roleCode, password] of [
      ['owner', 'OWNER', OPTIONS.ownerPassword],
      ['admin', 'ADMIN', OPTIONS.adminPassword],
    ] as const) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { username },
        include: { role: true, branches: true },
      });
      expect(user.role.code).toBe(roleCode);
      expect(user.mustChangePassword).toBe(true);
      await expect(verifyPassword(user.passwordHash, password)).resolves.toBe(true);
      expect(user.branches).toEqual([
        expect.objectContaining({ branchId: s1.id, isDefault: true }),
      ]);
    }

    const categories = await prisma.category.findMany({ where: { parentId: null } });
    expect(categories.map((c) => c.name).sort()).toEqual(['Accesorios', 'Bolsos', 'Calzado']);

    expect(summary.created).toContain('Permiso users.read');
    expect(summary.deleted).toEqual([]);
    expect(formatSummary('Seed base terminado.', summary)).toMatch(
      /Creado \(\d+\):[\s\S]*Borrado: nada/,
    );
  });

  it('es idempotente y no sobrescribe ediciones del usuario (T22)', async () => {
    await seedBase(prisma, OPTIONS);
    const before = { counts: await counts(prisma), ids: await ids(prisma) };

    const second = await seedBase(prisma, OPTIONS);
    expect({ counts: await counts(prisma), ids: await ids(prisma) }).toEqual(before);
    expect(second).toEqual({ created: [], updated: [], deleted: [] });
    expect(formatSummary('Seed base terminado.', second)).toContain('Creado: nada');

    const s1 = await prisma.branch.update({ where: { code: 'S1' }, data: { name: 'Matriz' } });
    await prisma.branch.update({ where: { code: 'S2' }, data: { name: 'Plaza Norte' } });
    await prisma.cashRegister.update({
      where: { branchId_code: { branchId: s1.id, code: 'C1' } },
      data: { name: 'Caja principal' },
    });
    await prisma.user.update({
      where: { username: 'owner' },
      data: { passwordHash: 'hash-owner' },
    });
    await prisma.user.update({
      where: { username: 'admin' },
      data: { passwordHash: 'hash-admin' },
    });

    await seedBase(prisma, OPTIONS);

    expect((await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } })).name).toBe('Matriz');
    expect((await prisma.branch.findUniqueOrThrow({ where: { code: 'S2' } })).name).toBe(
      'Plaza Norte',
    );
    expect(
      (
        await prisma.cashRegister.findUniqueOrThrow({
          where: { branchId_code: { branchId: s1.id, code: 'C1' } },
        })
      ).name,
    ).toBe('Caja principal');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } })).passwordHash,
    ).toBe('hash-owner');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).passwordHash,
    ).toBe('hash-admin');
    expect(await counts(prisma)).toEqual(before.counts);
  });

  it('restaura los permisos de los roles y borra permisos ajenos al catálogo (T23)', async () => {
    await seedBase(prisma, OPTIONS);
    const seller = await prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } });
    const sellRead = await prisma.permission.findUniqueOrThrow({ where: { code: 'pos.sell' } });
    const usersManage = await prisma.permission.findUniqueOrThrow({
      where: { code: 'users.manage' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: seller.id, permissionId: sellRead.id } },
    });
    await prisma.rolePermission.create({
      data: { roleId: seller.id, permissionId: usersManage.id },
    });

    const stale = await prisma.permission.create({
      data: { code: 'legacy.thing', module: 'legacy', description: 'Permiso viejo' },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.userPermission.create({ data: { userId: admin.id, permissionId: stale.id } });
    await prisma.rolePermission.create({ data: { roleId: seller.id, permissionId: stale.id } });

    const summary = await seedBase(prisma, OPTIONS);

    for (const role of SYSTEM_ROLES) {
      expect(await rolePermissionCodes(prisma, role.code)).toEqual([...role.permissions].sort());
    }
    expect(await prisma.permission.findUnique({ where: { code: 'legacy.thing' } })).toBeNull();
    expect(await prisma.userPermission.count({ where: { permissionId: stale.id } })).toBe(0);
    expect(await prisma.permission.count()).toBe(25);
    expect(summary.deleted).toEqual(['Permiso legacy.thing']);
    expect(summary.updated).toEqual(['Permisos del rol SELLER']);
  });

  it('actualiza módulo y descripción de un permiso existente', async () => {
    await seedBase(prisma, OPTIONS);
    await prisma.permission.update({ where: { code: 'pos.sell' }, data: { description: 'x' } });
    await prisma.role.update({ where: { code: 'SELLER' }, data: { name: 'Otro nombre' } });

    const summary = await seedBase(prisma, OPTIONS);

    expect(
      (await prisma.permission.findUniqueOrThrow({ where: { code: 'pos.sell' } })).description,
    ).toBe('Vender');
    expect((await prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } })).name).toBe(
      'Vendedor',
    );
    expect(summary.updated.sort()).toEqual(['Permiso pos.sell', 'Rol SELLER']);
  });
});
