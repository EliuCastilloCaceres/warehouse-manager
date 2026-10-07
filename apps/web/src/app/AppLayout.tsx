import { Link, NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';
import { MODULES } from './modules';

/** Barra inferior fija en celular (< md) y barra lateral desde md. */
export function AppLayout() {
  return (
    <div className="min-h-dvh md:flex">
      <aside className="md:flex md:w-56 md:shrink-0 md:flex-col md:border-r">
        <header className="flex h-14 items-center border-b px-4 md:border-b-0">
          <Link to="/" className="font-semibold">
            warehouse-manager
          </Link>
        </header>
        <nav
          aria-label="Módulos"
          className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t bg-background pb-[env(safe-area-inset-bottom)] md:static md:flex md:flex-col md:gap-1 md:border-t-0 md:p-2 md:pb-2"
        >
          {MODULES.map(({ path, label, shortLabel, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground',
                  'md:flex-row md:justify-start md:gap-3 md:rounded-md md:px-3 md:text-sm',
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
    </div>
  );
}
