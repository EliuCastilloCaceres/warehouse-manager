import type { PermissionCode } from '@warehouse-manager/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useBranch } from '@/features/branch/BranchProvider';
import { NoBranchesPage } from '@/features/branch/SelectBranchPage';
import { useAuth } from './AuthProvider';
import { NoAccessPage } from './NoAccessPage';
import { withNext } from './safeNext';
import { sessionStore } from './sessionStore';

function useCurrentPath(): string {
  const location = useLocation();
  return `${location.pathname}${location.search}`;
}

/** Sin sesión → /login?next=<ruta actual>. */
export function RequireAuth() {
  const { session } = useAuth();
  const current = useCurrentPath();
  if (!session) {
    // Tras un logout se va a /login a secas; si la sesión expiró, se vuelve a la ruta actual.
    const next = sessionStore.lastClearReason() === 'logout' ? '/' : current;
    return <Navigate to={withNext('/login', next)} replace />;
  }
  return <Outlet />;
}

/** Con `mustChangePassword` → /change-password (la API también lo exige). */
export function RequirePasswordChanged() {
  const { me } = useAuth();
  const current = useCurrentPath();
  if (me?.user.mustChangePassword)
    return <Navigate to={withNext('/change-password', current)} replace />;
  return <Outlet />;
}

/** Sin sucursal elegida → /select-branch; sin sucursales → aviso. */
export function RequireBranch() {
  const { branches, needsSelection } = useBranch();
  const current = useCurrentPath();
  if (branches.length === 0) return <NoBranchesPage />;
  if (needsSelection) return <Navigate to={withNext('/select-branch', current)} replace />;
  return <Outlet />;
}

interface PermissionProps {
  perm?: PermissionCode;
  anyOf?: readonly PermissionCode[];
}

function useHasPermission({ perm, anyOf }: PermissionProps): boolean {
  const { can, canAny } = useAuth();
  return (perm ? can(perm) : true) && (anyOf ? canAny(anyOf) : true);
}

/** Sin el permiso → "Sin acceso" en la misma URL (no redirige). */
export function RequirePermission({
  children,
  ...props
}: PermissionProps & { children: ReactNode }) {
  return useHasPermission(props) ? children : <NoAccessPage />;
}

/** Muestra `children` si el usuario tiene el permiso (o alguno de `anyOf`); si no, `fallback`. */
export function Can({
  children,
  fallback = null,
  ...props
}: PermissionProps & { children: ReactNode; fallback?: ReactNode }) {
  return useHasPermission(props) ? children : fallback;
}
