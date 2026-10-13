import { DomainError } from '../../core/errors.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;

const PERMISSION_CODE = { select: { permission: { select: { code: true } } } } as const;

export const USER_INCLUDE = {
  role: { include: { permissions: PERMISSION_CODE } },
  permissions: PERMISSION_CODE,
  branches: { include: { branch: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserInclude;

export type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

const ROLE_INCLUDE = { permissions: PERMISSION_CODE } satisfies Prisma.RoleInclude;

export type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

export function findUserRow(db: Db, id: string): Promise<UserRow | null> {
  return db.user.findUnique({ where: { id }, include: USER_INCLUDE });
}

export async function listUserRows(
  db: PrismaClient,
  where: Prisma.UserWhereInput,
  orderBy: Prisma.UserOrderByWithRelationInput[],
  page: { skip: number; take: number },
): Promise<[number, UserRow[]]> {
  return db.$transaction([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy, ...page, include: USER_INCLUDE }),
  ]);
}

export function usernameExists(db: Db, username: string): Promise<boolean> {
  return db.user.count({ where: { username } }).then((count) => count > 0);
}

export function findRoles(db: Db): Promise<RoleRow[]> {
  return db.role.findMany({ include: ROLE_INCLUDE });
}

export function findRoleById(db: Db, id: string): Promise<RoleRow | null> {
  return db.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
}

/** Ids de las sucursales activas entre las pedidas. */
export async function activeBranchIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const rows = await db.branch.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Ids de los permisos pedidos. Si alguno está en el catálogo de `shared` pero no en la BD
 * (se desplegó sin correr el seed), falla en lugar de ignorarlo.
 */
export async function permissionIdsByCode(db: Db, codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
  const found = new Set(rows.map((row) => row.code));
  const missing = [...new Set(codes)].filter((code) => !found.has(code));
  if (missing.length > 0) {
    throw new DomainError('INTERNAL_ERROR', {
      message: `Faltan permisos en la base de datos (${missing.join(', ')}); ejecuta \`pnpm db:seed\`.`,
      details: { permissions: missing },
    });
  }
  return rows.map((row) => row.id);
}

export interface NewUser {
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  passwordHash: string;
}

export async function createUserRow(
  db: Db,
  user: NewUser,
  branches: { ids: readonly string[]; defaultId: string },
  extraPermissions: readonly string[],
): Promise<UserRow> {
  const permissionIds = await permissionIdsByCode(db, extraPermissions);
  return db.user.create({
    data: {
      ...user,
      mustChangePassword: true,
      branches: {
        create: branches.ids.map((branchId) => ({
          branchId,
          isDefault: branchId === branches.defaultId,
        })),
      },
      permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
    },
    include: USER_INCLUDE,
  });
}

export function updateUserScalars(
  db: Db,
  id: string,
  data: Pick<Prisma.UserUncheckedUpdateInput, 'fullName' | 'email' | 'phone' | 'roleId'>,
) {
  // updatedAt explícito: también cambia cuando solo cambian sucursales o permisos.
  return db.user.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** Reemplaza las sucursales del usuario (exactamente una predeterminada). */
export async function replaceBranches(
  db: Db,
  userId: string,
  ids: readonly string[],
  defaultId: string,
): Promise<void> {
  await db.userBranch.deleteMany({ where: { userId } });
  await db.userBranch.createMany({
    data: ids.map((branchId) => ({ userId, branchId, isDefault: branchId === defaultId })),
  });
}

/** Reemplaza los permisos extra del usuario. */
export async function replaceExtraPermissions(
  db: Db,
  userId: string,
  codes: readonly string[],
): Promise<void> {
  const permissionIds = await permissionIdsByCode(db, codes);
  await db.userPermission.deleteMany({ where: { userId } });
  if (permissionIds.length > 0) {
    await db.userPermission.createMany({
      data: permissionIds.map((permissionId) => ({ userId, permissionId })),
    });
  }
}

export function setActive(db: Db, id: string, isActive: boolean) {
  return db.user.update({ where: { id }, data: { isActive } });
}

/** Nueva contraseña con cambio obligatorio al entrar. */
export function setPassword(db: Db, id: string, passwordHash: string) {
  return db.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
}

export function findOwnerId(db: Db): Promise<string | null> {
  return db.user
    .findFirst({ where: { role: { code: 'OWNER' } }, select: { id: true } })
    .then((row) => row?.id ?? null);
}
