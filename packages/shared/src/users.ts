import { z } from 'zod';
import { PasswordPolicy } from './auth.js';
import { Uuid } from './common.js';
import { RoleDto, UserDto } from './dto/security.js';
import { PaginationQuery, sortQuery } from './pagination.js';
import { PERMISSION_MODULES, PermissionCode } from './permissions.js';

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._-]{3,30}$/,
    'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo',
  );

/** Contraseña al crear o restablecer: la genera el servidor o la escribe el administrador. */
export const PasswordInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate') }),
  z.object({ mode: z.literal('manual'), value: PasswordPolicy }),
]);
export type PasswordInput = z.infer<typeof PasswordInput>;

const FullName = z.string().trim().min(1, 'El nombre es obligatorio').max(100);
const Email = z.email('Correo no válido').nullable();
const Phone = z.string().trim().max(30).nullable();
const PermissionSet = z.array(PermissionCode).transform((v) => [...new Set(v)].sort());
const BranchIds = z
  .array(Uuid)
  .min(1, 'Elige al menos una sucursal')
  .transform((v) => [...new Set(v)]);

const DEFAULT_BRANCH_MESSAGE = 'La sucursal predeterminada debe estar entre las asignadas';

export const UserCreateInput = z
  .object({
    username: UsernameSchema,
    fullName: FullName,
    email: Email.optional().default(null),
    phone: Phone.optional().default(null),
    roleId: Uuid,
    branchIds: BranchIds,
    defaultBranchId: Uuid,
    extraPermissions: PermissionSet.default([]),
    password: PasswordInput,
  })
  .refine((v) => v.branchIds.includes(v.defaultBranchId), {
    path: ['defaultBranchId'],
    message: DEFAULT_BRANCH_MESSAGE,
  });
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = z
  .strictObject({
    fullName: FullName.optional(),
    email: Email.optional(),
    phone: Phone.optional(),
    roleId: Uuid.optional(),
    branchIds: BranchIds.optional(),
    defaultBranchId: Uuid.optional(),
    extraPermissions: PermissionSet.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' })
  .refine(
    (v) =>
      !v.branchIds || (v.defaultBranchId !== undefined && v.branchIds.includes(v.defaultBranchId)),
    { path: ['defaultBranchId'], message: DEFAULT_BRANCH_MESSAGE },
  );
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

export const USER_SORT_FIELDS = ['fullName', 'username', 'lastLoginAt', 'createdAt'] as const;

export const UserListQuery = PaginationQuery.extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  roleId: Uuid.optional(),
  branchId: Uuid.optional(),
  sort: sortQuery(USER_SORT_FIELDS), // por defecto: fullName:asc
});
export type UserListQuery = z.infer<typeof UserListQuery>;

const RoleRef = z.object({ id: Uuid, code: z.string(), name: z.string() });
const UserBranchRef = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});

export const UserListItemDto = UserDto.extend({ role: RoleRef, branches: z.array(UserBranchRef) });
export type UserListItemDto = z.infer<typeof UserListItemDto>;

export const UserDetailDto = UserListItemDto.extend({
  extraPermissions: z.array(PermissionCode),
  effectivePermissions: z.array(PermissionCode),
});
export type UserDetailDto = z.infer<typeof UserDetailDto>;

export const UserCreatedDto = z.object({
  user: UserDetailDto,
  generatedPassword: z.string().nullable(),
});
export type UserCreatedDto = z.infer<typeof UserCreatedDto>;

export const PasswordResetResultDto = z.object({ generatedPassword: z.string().nullable() });
export type PasswordResetResultDto = z.infer<typeof PasswordResetResultDto>;

export const UsernameSuggestionDto = z.object({ username: UsernameSchema.nullable() });
export type UsernameSuggestionDto = z.infer<typeof UsernameSuggestionDto>;

export const RoleWithPermissionsDto = RoleDto.extend({
  permissions: z.array(PermissionCode),
  /** Según el actor: el rol no es `OWNER` y sus permisos ⊆ los del actor. */
  assignable: z.boolean(),
});
export type RoleWithPermissionsDto = z.infer<typeof RoleWithPermissionsDto>;

export const PermissionGroupDto = z.object({
  module: z.enum(PERMISSION_MODULES),
  permissions: z.array(z.object({ code: PermissionCode, description: z.string() })),
});
export type PermissionGroupDto = z.infer<typeof PermissionGroupDto>;

// Reglas puras (spec F4 §3): la API decide con ellas y la web deshabilita controles.

/** Permisos pedidos que el actor no tiene, sin duplicados y en el orden pedido. */
export function missingPermissions(
  actorPerms: readonly PermissionCode[],
  requested: readonly PermissionCode[],
): PermissionCode[] {
  const actor = new Set(actorPerms);
  return [...new Set(requested)].filter((code) => !actor.has(code));
}

/** El actor puede actuar sobre el objetivo si los permisos efectivos de este ⊆ los suyos. */
export function isWithinScope(
  actorPerms: readonly PermissionCode[],
  targetPerms: readonly PermissionCode[],
): boolean {
  return missingPermissions(actorPerms, targetPerms).length === 0;
}

/** `OWNER` nunca es asignable; otro rol lo es si sus permisos ⊆ los del actor. */
export function isAssignableRole(
  roleCode: string,
  rolePerms: readonly PermissionCode[],
  actorPerms: readonly PermissionCode[],
): boolean {
  return roleCode !== 'OWNER' && isWithinScope(actorPerms, rolePerms);
}

const USERNAME_MAX = 30;
const USERNAME_MIN = 3;

/**
 * Base del username sugerido: sin acentos, en minúsculas y solo `[a-z0-9]`. Con 2+ palabras,
 * inicial de la primera + la segunda completa (`"Juan Pérez López"` → `jperez`); con una, esa
 * palabra. Se recorta a 30; con menos de 3 caracteres → `null`.
 */
export function suggestUsernameBase(fullName: string): string | null {
  const words = fullName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  const [first, second] = words;
  if (!first) return null;
  const base = (second ? `${first[0]}${second}` : first).slice(0, USERNAME_MAX);
  return base.length >= USERNAME_MIN ? base : null;
}
