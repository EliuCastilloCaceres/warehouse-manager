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
}

export const MODULES: readonly AppModule[] = [
  { path: '/warehouse', label: 'Almacén', shortLabel: 'Almacén', icon: Warehouse },
  { path: '/products', label: 'Productos', shortLabel: 'Productos', icon: Package },
  { path: '/pos', label: 'POS', shortLabel: 'POS', icon: ShoppingCart },
  { path: '/reports', label: 'Reportes', shortLabel: 'Reportes', icon: ChartColumn },
  { path: '/users', label: 'Usuarios', shortLabel: 'Usuarios', icon: Users },
  { path: '/settings', label: 'Ajustes', shortLabel: 'Ajustes', icon: Settings },
];
