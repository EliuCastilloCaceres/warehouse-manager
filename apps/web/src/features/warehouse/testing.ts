// Datos de prueba del almacén (solo los importan los tests).
import {
  type ContentRowDto,
  type LocateResultDto,
  type LocateVariantDto,
  type NodeContentDto,
  occupancyLevel,
  type OccupancyDto,
  type PermissionCode,
  type RackNodeDto,
  type SystemRoleCode,
  type WarehouseDto,
  type WarehouseTreeDto,
} from '@warehouse-manager/shared';
import { makeListItem, makeVariant } from '@/features/products/testing';
import { BRANCH_S1, makeSession } from '@/test/fixtures';
import { contentSearch, treeSearch, type TreeFilters } from './api';

const NOW = '2026-10-14T15:00:00.000Z';
const stamps = { createdAt: NOW, updatedAt: NOW };
let counter = 0;
export const uuid = (prefix = 'aaaaaaaa') =>
  `${prefix}-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export const WAREHOUSE: WarehouseDto = {
  id: 'aaaaaaaa-1111-4000-8000-000000000001',
  branchId: BRANCH_S1.id,
  code: 'ALM1',
  name: 'Almacén principal',
  isActive: true,
  ...stamps,
};

export const STAGING_RACK_ID = 'aaaaaaaa-1111-4000-8000-000000000002';

export function occupancy(occupied: number, capacity: number, reserved = 0): OccupancyDto {
  return {
    capacity,
    occupied,
    reserved,
    free: capacity - occupied,
    pct: capacity > 0 ? Math.round((occupied * 1000) / capacity) / 10 : null,
    level: occupancyLevel(occupied, capacity),
  };
}

export function makeRack(
  locationCode: string,
  occupied: number,
  overrides: Partial<RackNodeDto> = {},
): RackNodeDto {
  const capacity = overrides.capacityUnits ?? 40;
  return {
    id: uuid('bbbbbbbb'),
    containerId: uuid('cccccccc'),
    warehouseId: WAREHOUSE.id,
    code: locationCode.slice(-2),
    locationCode,
    capacityUnits: capacity,
    labelColor: null,
    isActive: true,
    ...stamps,
    occupancy: occupancy(occupied, capacity),
    colorHex: null,
    ...overrides,
  };
}

/** Zona A (2 racks, azul) y zona B (1 rack); 12 unidades en staging. */
export function makeTree(overrides: Partial<WarehouseTreeDto> = {}): WarehouseTreeDto {
  const zone = (code: string, name: string, color: string | null, racks: RackNodeDto[]) => {
    const zoneId = uuid('dddddddd');
    const containerId = uuid('cccccccc');
    const total = racks.reduce((s, r) => s + r.occupancy.occupied, 0);
    const capacity = racks.reduce((s, r) => s + r.capacityUnits, 0);
    return {
      id: zoneId,
      warehouseId: WAREHOUSE.id,
      code,
      name,
      color,
      isStaging: false,
      priority: 0,
      sortOrder: 0,
      isActive: true,
      ...stamps,
      occupancy: occupancy(total, capacity),
      containers: [
        {
          id: containerId,
          zoneId,
          code: '01',
          name: null,
          isActive: true,
          ...stamps,
          occupancy: occupancy(total, capacity),
          racks: racks.map((r) => ({ ...r, containerId })),
        },
      ],
    };
  };
  return {
    warehouse: WAREHOUSE,
    totals: occupancy(33, 120),
    staging: { rackId: STAGING_RACK_ID, locationCode: 'STG-01-01', occupied: 12, reserved: 0 },
    zones: [
      zone('A', 'Calzado dama', '#2563EB', [
        makeRack('A-01-01', 10, { colorHex: '#2563EB' }),
        makeRack('A-01-02', 3, { colorHex: '#2563EB' }),
      ]),
      zone('B', 'Bolsos', null, [makeRack('B-01-01', 20)]),
    ],
    ...overrides,
  };
}

export function makeRow(overrides: Partial<ContentRowDto> = {}): ContentRowDto {
  return {
    variantId: uuid('eeeeeeee'),
    sku: 'ZAP0101-25-NEG',
    productName: 'Zapato de piel dama',
    variantLabel: '25 · Negro',
    thumbUrl: null,
    quantity: 4,
    reservedQty: 0,
    available: 4,
    stock: { status: 'DISPONIBLE', enPiso: false, enStaging: false },
    ...overrides,
  };
}

export function makeContent(
  node: Partial<NodeContentDto['node']> & { id: string; code: string },
  items: ContentRowDto[],
): NodeContentDto {
  return {
    node: {
      kind: 'rack',
      name: null,
      isStaging: false,
      isActive: true,
      colorHex: null,
      occupancy: occupancy(
        items.reduce((s, i) => s + i.quantity, 0),
        40,
      ),
      ...node,
    },
    items,
    page: 1,
    pageSize: 50,
    total: items.length,
  };
}

const product = makeListItem({ id: 'dddddddd-2222-4000-8000-000000000001' });

export function makeLocateVariant(
  sku: string,
  overrides: Partial<LocateVariantDto> = {},
): LocateVariantDto {
  const variant = makeVariant(product.id, {
    id: uuid('eeeeeeee'),
    sku,
    size: sku.split('-')[1] ?? null,
    color: 'Negro',
  });
  return {
    variant,
    totals: { quantity: 6, reservedQty: 1, available: 5 },
    stock: { status: 'DISPONIBLE', enPiso: true, enStaging: true },
    locations: [
      {
        rackId: uuid('bbbbbbbb'),
        locationCode: 'A-01-01',
        zoneName: 'Calzado dama',
        colorHex: '#2563EB',
        isStaging: false,
        quantity: 4,
        reservedQty: 1,
        available: 3,
      },
      {
        rackId: STAGING_RACK_ID,
        locationCode: 'STG-01-01',
        zoneName: 'Staging',
        colorHex: null,
        isStaging: true,
        quantity: 2,
        reservedQty: 0,
        available: 2,
      },
    ],
    otherBranches: null,
    ...overrides,
  };
}

export function makeLocate(variants: LocateVariantDto[]): LocateResultDto {
  return { product: { ...product, variantCount: variants.length }, variants };
}

// ─── Claves de `mockFetch` ───────────────────────────────────────────────────

export const WAREHOUSES = 'GET /api/v1/warehouses';
export const treeKey = (filters: TreeFilters = {}) =>
  `GET /api/v1/warehouses/${WAREHOUSE.id}/tree${treeSearch(filters)}`;
export const rackKey = (id: string, status?: Parameters<typeof contentSearch>[0]) =>
  `GET /api/v1/racks/${id}?${contentSearch(status)}`;
export const locateKey = (code: string) =>
  `GET /api/v1/inventory/locate?${new URLSearchParams({ code })}`;
export const byLocationKey = (code: string) =>
  `GET /api/v1/inventory/by-location?${new URLSearchParams({ code, pageSize: '100' })}`;
export const suggestKey = (variantId: string, quantity: number) =>
  `GET /api/v1/inventory/suggest-locations?${new URLSearchParams({ variantId, quantity: String(quantity) })}`;

/** Handler de `mockFetch` que responde 200 con `body`. */
export const ok = (body: unknown) => () =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** Rutas simuladas con la sesión del rol (más permisos extra, o sin algunos) y el almacén. */
export function warehouseRoutes<R extends object>(
  routes: R,
  {
    role = 'MANAGER',
    add = [],
    remove = [],
  }: { role?: SystemRoleCode; add?: PermissionCode[]; remove?: PermissionCode[] } = {},
) {
  const session = makeSession({ role });
  session.me.permissions = [...session.me.permissions, ...add]
    .filter((p) => !remove.includes(p))
    .sort();
  return {
    'POST /api/v1/auth/refresh': ok(session),
    [WAREHOUSES]: ok([WAREHOUSE]),
    ...routes,
  };
}
