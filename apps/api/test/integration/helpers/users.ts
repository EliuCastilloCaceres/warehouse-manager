import type { PermissionCode, SystemRoleCode } from '@warehouse-manager/shared';
import { hashPassword } from '../../../src/core/password.js';
import type { PrismaClient } from '../../../src/core/prisma-client.js';

export const DEFAULT_PASSWORD = 'clave-de-prueba-1';

export interface TestUserOptions {
  username: string;
  password?: string;
  role?: SystemRoleCode;
  /** Códigos de sucursal con acceso (requiere el seed base). */
  branches?: string[];
  defaultBranch?: string | null;
  extraPermissions?: PermissionCode[];
  mustChangePassword?: boolean;
  isActive?: boolean;
}

/** Crea un usuario de prueba sobre el seed base (roles, permisos y sucursales S1/S2). */
export async function createUser(prisma: PrismaClient, options: TestUserOptions) {
  const {
    username,
    password = DEFAULT_PASSWORD,
    role = 'SELLER',
    branches = ['S1'],
    defaultBranch = branches[0] ?? null,
    extraPermissions = [],
    mustChangePassword = false,
    isActive = true,
  } = options;
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: role } });
  const branchRows = await prisma.branch.findMany({ where: { code: { in: branches } } });
  const permissionRows = await prisma.permission.findMany({
    where: { code: { in: extraPermissions } },
  });
  return prisma.user.create({
    data: {
      username,
      fullName: `Usuario ${username}`,
      passwordHash: await hashPassword(password),
      roleId: roleRow.id,
      mustChangePassword,
      isActive,
      branches: {
        create: branchRows.map((b) => ({ branchId: b.id, isDefault: b.code === defaultBranch })),
      },
      permissions: { create: permissionRows.map((p) => ({ permissionId: p.id })) },
    },
  });
}
