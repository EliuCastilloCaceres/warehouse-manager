import type { PermissionCode } from '@warehouse-manager/shared';
import { Navigate, NavLink, Outlet } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';

interface SettingsTab {
  path: string;
  label: string;
  permission: PermissionCode;
}

const TABS: readonly SettingsTab[] = [
  { path: '/settings/branch', label: 'Sucursal', permission: 'settings.branch' },
  { path: '/settings/registers', label: 'Cajas', permission: 'settings.registers' },
];

function useAllowedTabs(): SettingsTab[] {
  const { can } = useAuth();
  return TABS.filter((tab) => can(tab.permission));
}

/** `/settings`: pestañas permitidas y la sección elegida (spec F5 §3). */
export function SettingsPage() {
  const tabs = useAllowedTabs();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ajustes</h1>
      <nav aria-label="Secciones de Ajustes" className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                '-mb-px flex min-h-11 items-center border-b-2 px-4 text-sm text-muted-foreground',
                isActive ? 'border-primary font-medium text-foreground' : 'border-transparent',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}

/** `/settings` a secas: lleva a la primera pestaña permitida. */
export function SettingsIndex() {
  const [first] = useAllowedTabs();
  return first ? <Navigate to={first.path} replace /> : null;
}
