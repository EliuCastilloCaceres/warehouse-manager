import type { PermissionCode } from '@warehouse-manager/shared';
import {
  ChartColumn,
  Package,
  Settings,
  ShoppingCart,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export interface AppModule {
  path: string;
  label: string;
  /** Etiqueta corta para la barra inferior del celular. */
  shortLabel: string;
  icon: LucideIcon;
  /** Basta con uno de estos permisos para ver el módulo (spec F3 §4). */
  permissions: readonly PermissionCode[];
}

export const MODULES: readonly AppModule[] = [
  {
    path: '/warehouse',
    label: 'Almacén',
    shortLabel: 'Almacén',
    icon: Warehouse,
    permissions: ['warehouse.read'],
  },
  {
    path: '/products',
    label: 'Productos',
    shortLabel: 'Productos',
    icon: Package,
    permissions: ['products.read'],
  },
  { path: '/pos', label: 'POS', shortLabel: 'POS', icon: ShoppingCart, permissions: ['pos.sell'] },
  {
    path: '/reports',
    label: 'Reportes',
    shortLabel: 'Reportes',
    icon: ChartColumn,
    permissions: ['reports.sales'],
  },
  {
    path: '/users',
    label: 'Usuarios',
    shortLabel: 'Usuarios',
    icon: Users,
    permissions: ['users.read'],
  },
  {
    path: '/settings',
    label: 'Ajustes',
    shortLabel: 'Ajustes',
    icon: Settings,
    permissions: ['settings.branch', 'settings.registers'],
  },
];
