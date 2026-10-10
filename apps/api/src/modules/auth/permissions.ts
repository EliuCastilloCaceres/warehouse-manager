import { PERMISSIONS, type PermissionCode } from '@warehouse-manager/shared';

const CATALOG = new Set<string>(PERMISSIONS.map((p) => p.code));

/**
 * Permisos del rol ∪ permisos extra del usuario: sin duplicados, ordenados y filtrados
 * al catálogo de `shared` (un código retirado del catálogo nunca llega al token).
 */
export function effectivePermissions(
  rolePermissions: readonly string[],
  extraPermissions: readonly string[] = [],
): PermissionCode[] {
  return [...new Set([...rolePermissions, ...extraPermissions])]
    .filter((code): code is PermissionCode => CATALOG.has(code))
    .sort();
}
