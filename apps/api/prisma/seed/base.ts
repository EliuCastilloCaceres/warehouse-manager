import { PERMISSIONS, STAGING_ZONE_CODE, SYSTEM_ROLES } from '@warehouse-manager/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/core/password.js';
import { emptySummary, type SeedSummary } from './summary.js';

type Tx = Prisma.TransactionClient;

export interface SeedBaseOptions {
  ownerPassword: string;
  adminPassword: string;
}

const BRANCHES = [
  { code: 'S1', name: 'Sucursal 1' },
  { code: 'S2', name: 'Sucursal 2' },
];
const REGISTERS = [
  { code: 'C1', name: 'Caja 1' },
  { code: 'C2', name: 'Caja 2' },
];
const ROOT_CATEGORIES = ['Calzado', 'Bolsos', 'Accesorios'];

/** Busca por clave natural; si no existe lo crea y lo anota. Nunca modifica lo existente. */
async function ensure<T>(
  summary: SeedSummary,
  label: string,
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  if (existing) return existing;
  summary.created.push(label);
  return create();
}

async function syncPermissions(tx: Tx, summary: SeedSummary): Promise<Map<string, string>> {
  const catalog = new Set<string>(PERMISSIONS.map((p) => p.code));
  const existing = await tx.permission.findMany();

  for (const stale of existing.filter((p) => !catalog.has(p.code))) {
    // Cascade a role_permission y user_permission.
    await tx.permission.delete({ where: { id: stale.id } });
    summary.deleted.push(`Permiso ${stale.code}`);
  }

  const ids = new Map<string, string>();
  for (const { code, module, description } of PERMISSIONS) {
    const current = existing.find((p) => p.code === code);
    if (!current) {
      const created = await tx.permission.create({ data: { code, module, description } });
      summary.created.push(`Permiso ${code}`);
      ids.set(code, created.id);
    } else {
      if (current.module !== module || current.description !== description) {
        await tx.permission.update({ where: { id: current.id }, data: { module, description } });
        summary.updated.push(`Permiso ${code}`);
      }
      ids.set(code, current.id);
    }
  }
  return ids;
}

async function syncSystemRoles(
  tx: Tx,
  summary: SeedSummary,
  permissionIds: Map<string, string>,
): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();
  for (const role of SYSTEM_ROLES) {
    let current = await tx.role.findUnique({ where: { code: role.code } });
    if (!current) {
      current = await tx.role.create({
        data: { code: role.code, name: role.name, isSystem: true },
      });
      summary.created.push(`Rol ${role.code}`);
    } else if (current.name !== role.name || !current.isSystem) {
      await tx.role.update({
        where: { id: current.id },
        data: { name: role.name, isSystem: true },
      });
      summary.updated.push(`Rol ${role.code}`);
    }
    roleIds.set(role.code, current.id);

    // Los permisos del rol deben coincidir exactamente con SYSTEM_ROLES.
    const desired = new Set(role.permissions.map((code) => permissionIds.get(code)!));
    const assigned = await tx.rolePermission.findMany({ where: { roleId: current.id } });
    const extra = assigned.filter((rp) => !desired.has(rp.permissionId));
    const missing = [...desired].filter((id) => !assigned.some((rp) => rp.permissionId === id));
    if (extra.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { roleId: current.id, permissionId: { in: extra.map((rp) => rp.permissionId) } },
      });
    }
    if (missing.length > 0) {
      await tx.rolePermission.createMany({
        data: missing.map((permissionId) => ({ roleId: current.id, permissionId })),
      });
    }
    if (assigned.length > 0 && (extra.length > 0 || missing.length > 0)) {
      summary.updated.push(`Permisos del rol ${role.code}`);
    }
  }
  return roleIds;
}

/** Sucursal con su contador, cajas, almacén y staging (zona STG, contenedor 01, rack STG-01-01). */
async function ensureBranch(
  tx: Tx,
  summary: SeedSummary,
  { code, name }: { code: string; name: string },
): Promise<string> {
  const branch = await ensure(
    summary,
    `Sucursal ${code}`,
    () => tx.branch.findUnique({ where: { code } }),
    () => tx.branch.create({ data: { code, name } }),
  );
  await ensure(
    summary,
    `Contador SALE_FOLIO de ${code}`,
    () =>
      tx.branchCounter.findUnique({
        where: { branchId_key: { branchId: branch.id, key: 'SALE_FOLIO' } },
      }),
    () => tx.branchCounter.create({ data: { branchId: branch.id, key: 'SALE_FOLIO', value: 0 } }),
  );
  for (const register of REGISTERS) {
    await ensure(
      summary,
      `Caja ${register.code} de ${code}`,
      () =>
        tx.cashRegister.findUnique({
          where: { branchId_code: { branchId: branch.id, code: register.code } },
        }),
      () => tx.cashRegister.create({ data: { branchId: branch.id, ...register } }),
    );
  }
  const warehouse = await ensure(
    summary,
    `Almacén ALM1 de ${code}`,
    () =>
      tx.warehouse.findUnique({ where: { branchId_code: { branchId: branch.id, code: 'ALM1' } } }),
    () =>
      tx.warehouse.create({
        data: { branchId: branch.id, code: 'ALM1', name: 'Almacén principal' },
      }),
  );
  const zone = await ensure(
    summary,
    `Zona STG de ${code}`,
    () =>
      tx.zone.findUnique({
        where: { warehouseId_code: { warehouseId: warehouse.id, code: STAGING_ZONE_CODE } },
      }),
    () =>
      tx.zone.create({
        data: {
          warehouseId: warehouse.id,
          code: STAGING_ZONE_CODE,
          name: 'Staging',
          isStaging: true,
        },
      }),
  );
  const container = await ensure(
    summary,
    `Contenedor STG-01 de ${code}`,
    () => tx.container.findUnique({ where: { zoneId_code: { zoneId: zone.id, code: '01' } } }),
    () => tx.container.create({ data: { zoneId: zone.id, code: '01', name: 'Staging' } }),
  );
  await ensure(
    summary,
    `Rack STG-01-01 de ${code}`,
    () =>
      tx.rack.findUnique({
        where: { containerId_code: { containerId: container.id, code: '01' } },
      }),
    () =>
      tx.rack.create({
        data: {
          containerId: container.id,
          warehouseId: warehouse.id,
          code: '01',
          locationCode: 'STG-01-01',
          capacityUnits: 0,
        },
      }),
  );
  return branch.id;
}

async function ensureUser(
  tx: Tx,
  summary: SeedSummary,
  user: { username: string; fullName: string; roleId: string; passwordHash: string },
  defaultBranchId: string,
): Promise<void> {
  if (await tx.user.findUnique({ where: { username: user.username } })) return;
  await tx.user.create({
    data: {
      ...user,
      mustChangePassword: true,
      branches: { create: { branchId: defaultBranchId, isDefault: true } },
    },
  });
  summary.created.push(`Usuario ${user.username}`);
}

/**
 * Seed base idempotente (spec F1 §7.2), en una sola transacción: sincroniza permisos y roles
 * del sistema y crea lo que falte. Nunca modifica datos editables ni restablece contraseñas.
 */
export async function seedBase(
  prisma: PrismaClient,
  options: SeedBaseOptions,
): Promise<SeedSummary> {
  const [ownerHash, adminHash] = await Promise.all([
    hashPassword(options.ownerPassword),
    hashPassword(options.adminPassword),
  ]);
  const summary = emptySummary();

  await prisma.$transaction(
    async (tx) => {
      const permissionIds = await syncPermissions(tx, summary);
      const roleIds = await syncSystemRoles(tx, summary, permissionIds);

      const branchIds: string[] = [];
      for (const branch of BRANCHES) {
        branchIds.push(await ensureBranch(tx, summary, branch));
      }
      const s1Id = branchIds[0]!;

      await ensureUser(
        tx,
        summary,
        {
          username: 'owner',
          fullName: 'Propietario',
          roleId: roleIds.get('OWNER')!,
          passwordHash: ownerHash,
        },
        s1Id,
      );
      await ensureUser(
        tx,
        summary,
        {
          username: 'admin',
          fullName: 'Administrador',
          roleId: roleIds.get('ADMIN')!,
          passwordHash: adminHash,
        },
        s1Id,
      );

      for (const name of ROOT_CATEGORIES) {
        await ensure(
          summary,
          `Categoría ${name}`,
          () => tx.category.findFirst({ where: { parentId: null, name } }),
          () => tx.category.create({ data: { name } }),
        );
      }
    },
    { timeout: 60_000 },
  );

  return summary;
}
