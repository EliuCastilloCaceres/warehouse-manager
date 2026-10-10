import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranch } from '@/features/branch/BranchProvider';
import { cn } from '@/lib/utils';
import { MODULES } from './modules';
import { initialsOf, UserMenu } from './UserMenu';

/** Barra inferior fija en celular (< md) y barra lateral desde md; solo los módulos permitidos. */
export function AppLayout() {
  const { me, canAny } = useAuth();
  const { branches, branch } = useBranch();
  const [menuOpen, setMenuOpen] = useState(false);
  const modules = MODULES.filter((module) => canAny(module.permissions));

  return (
    <div className="min-h-dvh md:flex">
      <aside className="md:flex md:w-56 md:shrink-0 md:flex-col md:border-r">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:border-b-0">
          <Link to="/" className="font-semibold">
            warehouse-manager
          </Link>
          <div className="flex items-center gap-2">
            {branches.length > 1 && branch && (
              <span className="text-sm text-muted-foreground" title={branch.name}>
                {branch.code}
              </span>
            )}
            {me && (
              <button
                type="button"
                aria-label="Menú de usuario"
                onClick={() => setMenuOpen(true)}
                className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-medium"
              >
                {initialsOf(me.user.fullName)}
              </button>
            )}
          </div>
        </header>
        <nav
          aria-label="Módulos"
          className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t bg-background pb-[env(safe-area-inset-bottom)] md:static md:flex-col md:justify-start md:gap-1 md:border-t-0 md:p-2 md:pb-2"
        >
          {modules.map(({ path, label, shortLabel, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground',
                  'md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-md md:px-3 md:text-sm',
                  isActive && 'font-medium text-foreground md:bg-accent',
                )
              }
            >
              <Icon aria-hidden className="size-5" />
              <span className="md:hidden">{shortLabel}</span>
              <span className="hidden md:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-4 pb-24 md:pb-4">
        <Outlet />
      </main>
      <UserMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </div>
  );
}
