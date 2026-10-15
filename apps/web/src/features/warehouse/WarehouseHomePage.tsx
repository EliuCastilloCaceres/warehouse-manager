import type { PermissionCode } from '@warehouse-manager/shared';
import {
  ArrowLeft,
  ArrowLeftRight,
  History,
  Inbox,
  MapIcon,
  PackagePlus,
  QrCode,
  Search,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useWarehouse, useWarehouseTree } from './api';

interface Shortcut {
  to: string;
  label: string;
  permission: PermissionCode;
  icon: LucideIcon;
}

/** Accesos del inicio según permisos (spec F7 §8). */
export const SHORTCUTS: readonly Shortcut[] = [
  { to: '/warehouse/map', label: 'Mapa', permission: 'warehouse.read', icon: MapIcon },
  { to: '/warehouse/search', label: 'Buscar', permission: 'warehouse.read', icon: Search },
  { to: '/warehouse/putaway', label: 'Ubicar', permission: 'inventory.putaway', icon: PackagePlus },
  {
    to: '/warehouse/relocate',
    label: 'Reubicar',
    permission: 'inventory.relocate',
    icon: ArrowLeftRight,
  },
  { to: '/warehouse/staging', label: 'Staging', permission: 'inventory.putaway', icon: Inbox },
  {
    to: '/warehouse/search?mode=adjust',
    label: 'Ajustar',
    permission: 'inventory.adjust',
    icon: SlidersHorizontal,
  },
  {
    to: '/warehouse/movements',
    label: 'Kardex',
    permission: 'inventory.movements.read',
    icon: History,
  },
  { to: '/warehouse/setup', label: 'Configurar', permission: 'warehouse.manage', icon: Settings2 },
  { to: '/warehouse/labels', label: 'Etiquetas', permission: 'warehouse.labels', icon: QrCode },
];

/** Regreso al inicio del almacén. */
export function BackLink() {
  return (
    <Link
      to="/warehouse"
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Almacén
    </Link>
  );
}

/** `/warehouse`: accesos grandes; Staging muestra las unidades pendientes de ubicar. */
export function WarehouseHomePage() {
  const { can } = useAuth();
  const { warehouse } = useWarehouse();
  const showStaging = can('inventory.putaway');
  const tree = useWarehouseTree(showStaging ? warehouse?.id : undefined);
  const pending = tree.data?.staging.occupied;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Almacén</h1>
      <nav aria-label="Almacén">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SHORTCUTS.filter((s) => can(s.permission)).map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center font-medium hover:bg-muted/50"
              >
                <Icon aria-hidden className="size-7" />
                <span>{label}</span>
                {label === 'Staging' && pending !== undefined && (
                  <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
                    {pending} pzas
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
