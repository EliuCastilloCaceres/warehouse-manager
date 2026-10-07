import { z } from 'zod';

export const PERMISSION_MODULES = [
  'users',
  'products',
  'warehouse',
  'inventory',
  'pos',
  'reports',
  'settings',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSIONS = [
  { code: 'users.read', module: 'users', description: 'Ver usuarios' },
  { code: 'users.manage', module: 'users', description: 'Crear, editar y desactivar usuarios' },
  { code: 'users.permissions', module: 'users', description: 'Asignar permisos a usuarios' },
  { code: 'products.read', module: 'products', description: 'Ver productos' },
  {
    code: 'products.manage',
    module: 'products',
    description: 'Crear, editar y desactivar productos',
  },
  { code: 'products.import', module: 'products', description: 'Carga masiva de productos' },
  { code: 'products.labels', module: 'products', description: 'Imprimir etiquetas de producto' },
  { code: 'warehouse.read', module: 'warehouse', description: 'Ver almacén y ocupación' },
  {
    code: 'warehouse.manage',
    module: 'warehouse',
    description: 'Configurar zonas, contenedores y racks',
  },
  { code: 'warehouse.labels', module: 'warehouse', description: 'Imprimir etiquetas de ubicación' },
  { code: 'inventory.putaway', module: 'inventory', description: 'Ubicar productos' },
  { code: 'inventory.relocate', module: 'inventory', description: 'Reubicar productos' },
  { code: 'inventory.adjust', module: 'inventory', description: 'Ajustar inventario' },
  {
    code: 'inventory.override_capacity',
    module: 'inventory',
    description: 'Exceder la capacidad de un rack',
  },
  { code: 'inventory.movements.read', module: 'inventory', description: 'Ver kardex' },
  {
    code: 'inventory.other_branches.read',
    module: 'inventory',
    description: 'Ver existencias en otras sucursales',
  },
  { code: 'pos.session.open', module: 'pos', description: 'Abrir caja' },
  { code: 'pos.session.close', module: 'pos', description: 'Cerrar caja (corte)' },
  { code: 'pos.sell', module: 'pos', description: 'Vender' },
  { code: 'pos.discount', module: 'pos', description: 'Aplicar descuentos' },
  { code: 'pos.sale.cancel', module: 'pos', description: 'Cancelar ventas' },
  { code: 'reports.sales', module: 'reports', description: 'Ver reporte de ventas propias' },
  {
    code: 'reports.sales.all_users',
    module: 'reports',
    description: 'Ver ventas de todos los usuarios',
  },
  { code: 'settings.branch', module: 'settings', description: 'Editar datos de la sucursal' },
  { code: 'settings.registers', module: 'settings', description: 'Editar cajas' },
] as const satisfies readonly { code: string; module: PermissionModule; description: string }[];

type CatalogCode = (typeof PERMISSIONS)[number]['code'];

export const PermissionCode = z.enum(
  PERMISSIONS.map((p) => p.code) as [CatalogCode, ...CatalogCode[]],
);
export type PermissionCode = z.infer<typeof PermissionCode>;

const ALL_CODES: PermissionCode[] = PERMISSIONS.map((p) => p.code);

export const SystemRoleCode = z.enum(['OWNER', 'ADMIN', 'MANAGER', 'SELLER', 'WAREHOUSE_CLERK']);
export type SystemRoleCode = z.infer<typeof SystemRoleCode>;

export interface SystemRole {
  code: SystemRoleCode;
  name: string;
  permissions: readonly PermissionCode[];
}

export const SYSTEM_ROLES: readonly SystemRole[] = [
  // Derivado del catálogo: un permiso nuevo se incluye solo.
  { code: 'OWNER', name: 'Propietario', permissions: ALL_CODES },
  { code: 'ADMIN', name: 'Administrador', permissions: ALL_CODES },
  {
    code: 'MANAGER',
    name: 'Gerente',
    permissions: ALL_CODES.filter((code) => code !== 'users.permissions'),
  },
  {
    code: 'SELLER',
    name: 'Vendedor',
    permissions: [
      'products.read',
      'warehouse.read',
      'pos.session.open',
      'pos.session.close',
      'pos.sell',
      'inventory.relocate',
      'inventory.other_branches.read',
      'reports.sales',
    ],
  },
  {
    code: 'WAREHOUSE_CLERK',
    name: 'Almacenista',
    permissions: [
      'products.read',
      'products.labels',
      'warehouse.read',
      'warehouse.manage',
      'warehouse.labels',
      'inventory.putaway',
      'inventory.relocate',
      'inventory.movements.read',
    ],
  },
];
