import type { PermissionCode } from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../core/errors.js';

/** Quien opera el POS en la sucursal de la petición (rutas `branchScoped`). */
export interface PosActor {
  userId: string;
  permissions: readonly PermissionCode[];
  branchId: string;
  ip: string | null;
}

export function posActorOf(request: FastifyRequest): PosActor {
  const auth = request.auth!;
  return {
    userId: auth.userId,
    permissions: auth.permissions,
    branchId: request.branchId!,
    ip: request.ip,
  };
}

/**
 * Una sesión, carrito o venta de otra sucursal (o que no existe) → 403 `BRANCH_FORBIDDEN`,
 * como en F5: no se revela si el id existe en otra sucursal.
 */
export function assertInBranch<T extends { branchId: string }>(
  actor: PosActor,
  row: T | null | undefined,
): asserts row is T {
  if (!row || row.branchId !== actor.branchId) throw new DomainError('BRANCH_FORBIDDEN');
}

/** El permiso adicional que exige una parte de la petición (p. ej. `pos.discount`). */
export function assertPermission(actor: PosActor, permission: PermissionCode): void {
  if (!actor.permissions.includes(permission)) {
    throw new DomainError('FORBIDDEN', { details: { permission } });
  }
}

export const userRef = (user: { id: string; fullName: string }) => ({
  id: user.id,
  fullName: user.fullName,
});
