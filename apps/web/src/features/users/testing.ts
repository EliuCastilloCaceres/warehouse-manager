// Datos de prueba de la feature de usuarios (solo los importan los tests).
import {
  type AuthSessionDto,
  isAssignableRole,
  PERMISSION_MODULES,
  PERMISSIONS,
  type PermissionCode,
  type PermissionGroupDto,
  type RoleWithPermissionsDto,
  SYSTEM_ROLES,
  type SystemRoleCode,
  type UserDetailDto,
} from '@warehouse-manager/shared';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { branchStorageKey } from '@/features/branch/BranchProvider';
import { BRANCH_S1 } from '@/test/fixtures';
import { type UserFilters, usersSearch } from './api';

const NOW = '2026-10-12T15:00:00.000Z';

export const ROLE_IDS: Record<SystemRoleCode, string> = {
  OWNER: 'aaaaaaa0-0000-4000-8000-000000000001',
  ADMIN: 'aaaaaaa0-0000-4000-8000-000000000002',
  MANAGER: 'aaaaaaa0-0000-4000-8000-000000000003',
  SELLER: 'aaaaaaa0-0000-4000-8000-000000000004',
  WAREHOUSE_CLERK: 'aaaaaaa0-0000-4000-8000-000000000005',
};

export const permsOf = (code: SystemRoleCode): PermissionCode[] =>
  [...SYSTEM_ROLES.find((role) => role.code === code)!.permissions].sort();

/** `GET /roles` para un actor con esos permisos. */
export function makeRoles(actorPermissions: readonly PermissionCode[]): RoleWithPermissionsDto[] {
  return SYSTEM_ROLES.map((role) => ({
    id: ROLE_IDS[role.code],
    code: role.code,
    name: role.name,
    isSystem: true,
    createdAt: NOW,
    updatedAt: NOW,
    permissions: permsOf(role.code),
    assignable: isAssignableRole(role.code, role.permissions, actorPermissions),
  }));
}

export const PERMISSION_GROUPS: PermissionGroupDto[] = PERMISSION_MODULES.map((module) => ({
  module,
  permissions: PERMISSIONS.filter((p) => p.module === module).map(({ code, description }) => ({
    code,
    description,
  })),
}));

let counter = 0;

export function makeUser(
  overrides: Partial<UserDetailDto> & { roleCode?: SystemRoleCode } = {},
): UserDetailDto {
  const { roleCode = 'SELLER', ...rest } = overrides;
  const n = ++counter;
  const role = SYSTEM_ROLES.find((r) => r.code === roleCode)!;
  const extraPermissions = rest.extraPermissions ?? [];
  return {
    id: `bbbbbbb0-0000-4000-8000-${String(n).padStart(12, '0')}`,
    username: `usuario${n}`,
    fullName: `Usuario ${n}`,
    email: null,
    phone: null,
    roleId: ROLE_IDS[roleCode],
    type: 'STAFF',
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    role: { id: ROLE_IDS[roleCode], code: roleCode, name: role.name },
    branches: [BRANCH_S1],
    extraPermissions,
    effectivePermissions: [...new Set([...role.permissions, ...extraPermissions])].sort(),
    ...rest,
  };
}

export const DEFAULT_FILTERS: UserFilters = {
  q: '',
  status: 'active',
  roleId: '',
  branchId: '',
  page: 1,
};

/** Clave de `mockFetch` para `GET /users` con esos filtros. */
export const usersKey = (filters: Partial<UserFilters> = {}) =>
  `GET /api/v1/users?${usersSearch({ ...DEFAULT_FILTERS, ...filters })}`;

/** Con varias sucursales, deja elegida la primera (si no, la app pide elegirla). */
export function chooseFirstBranch(session: AuthSessionDto): void {
  localStorage.setItem(branchStorageKey(session.me.user.id), session.me.branches[0]!.id);
}

/** Abre el `Select` con esa etiqueta y elige la opción. */
export async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  await user.click(await screen.findByLabelText(label));
  await user.click(await screen.findByRole('option', { name: option }));
}
