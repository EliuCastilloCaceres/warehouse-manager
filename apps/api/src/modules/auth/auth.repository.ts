import type { PermissionCode } from '@warehouse-manager/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { effectivePermissions } from './permissions.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Roles que reciben todas las sucursales activas (spec F2 §2). */
const ALL_BRANCH_ROLES = new Set(['OWNER', 'ADMIN']);

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  role: { code: string; name: string };
  permissions: PermissionCode[];
  branches: { id: string; code: string; name: string; isDefault: boolean }[];
}

const USER_INCLUDE = {
  role: { include: { permissions: { include: { permission: { select: { code: true } } } } } },
  permissions: { include: { permission: { select: { code: true } } } },
  branches: { include: { branch: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

async function toAuthUser(db: Db, row: UserRow): Promise<AuthUser> {
  const defaults = new Set(row.branches.filter((ub) => ub.isDefault).map((ub) => ub.branchId));
  const branches = ALL_BRANCH_ROLES.has(row.role.code)
    ? await db.branch.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } })
    : row.branches
        .map((ub) => ub.branch)
        .filter((b) => b.isActive)
        .sort((a, b) => a.code.localeCompare(b.code));
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    role: { code: row.role.code, name: row.role.name },
    permissions: effectivePermissions(
      row.role.permissions.map((rp) => rp.permission.code),
      row.permissions.map((up) => up.permission.code),
    ),
    branches: branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      isDefault: defaults.has(b.id),
    })),
  };
}

export async function findUserByUsername(db: Db, username: string): Promise<AuthUser | null> {
  const row = await db.user.findUnique({ where: { username }, include: USER_INCLUDE });
  return row ? toAuthUser(db, row) : null;
}

export async function findUserById(db: Db, id: string): Promise<AuthUser | null> {
  const row = await db.user.findUnique({ where: { id }, include: USER_INCLUDE });
  return row ? toAuthUser(db, row) : null;
}

export function touchLastLogin(db: Db, userId: string, now: Date) {
  return db.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
}

export function updatePassword(db: Db, userId: string, passwordHash: string) {
  return db.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });
}

export function createRefreshToken(
  db: Db,
  data: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  },
) {
  return db.refreshToken.create({ data });
}

export function findRefreshByHash(db: Db, tokenHash: string) {
  return db.refreshToken.findUnique({ where: { tokenHash } });
}

/**
 * Revoca el token viejo y lo enlaza con el nuevo, solo si sigue activo.
 * Devuelve 0 si otra petición ya lo rotó (se trata como reutilización).
 */
export function rotateRefreshToken(db: Db, oldId: string, newId: string, now: Date) {
  return db.$executeRaw`
    UPDATE refresh_token SET revoked_at = ${now}, replaced_by_id = ${newId}::uuid
    WHERE id = ${oldId}::uuid AND revoked_at IS NULL`;
}

export function revokeToken(db: Db, id: string, now: Date) {
  return db.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
}

export function revokeFamily(db: Db, familyId: string, now: Date) {
  return db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export function revokeAllForUser(db: Db, userId: string, now: Date) {
  return db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}
