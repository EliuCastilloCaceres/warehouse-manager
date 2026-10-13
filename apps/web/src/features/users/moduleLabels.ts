import type { PermissionModule } from '@warehouse-manager/shared';

/** Nombre de cada módulo del catálogo en la matriz de permisos (solo presentación). */
export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  users: 'Usuarios',
  products: 'Productos',
  warehouse: 'Almacén',
  inventory: 'Inventario',
  pos: 'POS',
  reports: 'Reportes',
  settings: 'Ajustes',
};
