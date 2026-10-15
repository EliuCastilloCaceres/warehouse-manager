import {
  type AdjustInput,
  type ContainerBatchInput,
  ContainerChangeDto,
  type ContainerCreateInput,
  ContainerDto,
  type ContainerUpdateInput,
  type LabelScope,
  LocateResultDto,
  LocationLabelDto,
  MovementPageDto,
  type MovementListQuery,
  NodeContentDto,
  type PutawayBatchInput,
  type PutawayInput,
  type RackBatchInput,
  RackChangeDto,
  type RackCreateInput,
  RackDto,
  type RackUpdateInput,
  type RelocateInput,
  type StockFilter,
  StockOperationDto,
  SuggestionsDto,
  WarehouseDto,
  WarehouseTreeDto,
  ZoneChangeDto,
  type ZoneCreateInput,
  ZoneDto,
  type ZoneUpdateInput,
} from '@warehouse-manager/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/shared/api/apiClient';

const API = '/api/v1';

export type NodeKind = 'zone' | 'container' | 'rack';
const NODE_PATH: Record<NodeKind, string> = {
  zone: 'zones',
  container: 'containers',
  rack: 'racks',
};

export const CONTENT_PAGE_SIZE = 50;

/** Almacén de trabajo: el activo de la sucursal actual (el MVP tiene uno por sucursal). */
export function useWarehouse() {
  const query = useQuery({
    queryKey: ['warehouses'],
    queryFn: ({ signal }) =>
      apiFetch(`${API}/warehouses`, { schema: WarehouseDto.array(), signal }),
  });
  return { ...query, warehouse: query.data?.[0] };
}

export interface TreeFilters {
  status?: StockFilter;
  includeInactive?: boolean;
}

export function treeSearch({ status, includeInactive }: TreeFilters): string {
  const params = new URLSearchParams();
  if (includeInactive) params.set('includeInactive', 'true');
  if (status) params.set('status', status);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useWarehouseTree(warehouseId: string | undefined, filters: TreeFilters = {}) {
  return useQuery({
    queryKey: ['warehouse-tree', warehouseId, filters],
    queryFn: ({ signal }) =>
      apiFetch(`${API}/warehouses/${warehouseId}/tree${treeSearch(filters)}`, {
        schema: WarehouseTreeDto,
        signal,
      }),
    enabled: !!warehouseId,
    placeholderData: keepPreviousData,
  });
}

export function contentSearch(status?: StockFilter, page = 1): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(CONTENT_PAGE_SIZE) });
  if (status) params.set('status', status);
  return params.toString();
}

/** Contenido de una zona, un contenedor o un rack (clave `['rack', id]` para los racks). */
export function useNodeContent(
  node: { kind: NodeKind; id: string } | null,
  status?: StockFilter,
  page = 1,
) {
  return useQuery({
    queryKey: [node?.kind === 'rack' ? 'rack' : 'node', node?.id, status, page],
    queryFn: ({ signal }) =>
      apiFetch(`${API}/${NODE_PATH[node!.kind]}/${node!.id}?${contentSearch(status, page)}`, {
        schema: NodeContentDto,
        signal,
      }),
    enabled: !!node,
  });
}

/** Query string del kardex; los filtros vacíos no se envían. */
export function movementsSearch(query: Partial<MovementListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.toString();
}

export function useMovements(query: Partial<MovementListQuery>) {
  return useQuery({
    queryKey: ['movements', query],
    queryFn: ({ signal }) =>
      apiFetch(`${API}/inventory/movements?${movementsSearch(query)}`, {
        schema: MovementPageDto,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Tras una operación de stock: árbol, contenido, búsqueda y kardex (spec F7 §3). */
export function useInvalidateStock() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        ['warehouse-tree', 'rack', 'node', 'locate', 'movements'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    [queryClient],
  );
}

const post = <T>(path: string, schema: { parse: (v: unknown) => T }, body?: unknown) =>
  apiFetch(`${API}${path}`, { method: 'POST', body: body ?? {}, schema });
const patch = <T>(path: string, schema: { parse: (v: unknown) => T }, body: unknown) =>
  apiFetch(`${API}${path}`, { method: 'PATCH', body, schema });

export const inventoryApi = {
  locate: (code: string) =>
    apiFetch(`${API}/inventory/locate?${new URLSearchParams({ code })}`, {
      schema: LocateResultDto,
    }),
  byLocation: (code: string) =>
    apiFetch(`${API}/inventory/by-location?${new URLSearchParams({ code, pageSize: '100' })}`, {
      schema: NodeContentDto,
    }),
  suggest: (variantId: string, quantity: number) =>
    apiFetch(
      `${API}/inventory/suggest-locations?${new URLSearchParams({ variantId, quantity: String(quantity) })}`,
      { schema: SuggestionsDto },
    ),
  putaway: (input: PutawayInput) => post('/inventory/putaway', StockOperationDto, input),
  putawayBatch: (input: PutawayBatchInput) =>
    post('/inventory/putaway/batch', StockOperationDto, input),
  relocate: (input: RelocateInput) => post('/inventory/relocate', StockOperationDto, input),
  adjust: (input: AdjustInput) => post('/inventory/adjust', StockOperationDto, input),
};

export const structureApi = {
  createZone: (warehouseId: string, input: Partial<ZoneCreateInput>) =>
    post(`/warehouses/${warehouseId}/zones`, ZoneDto, input),
  updateZone: (id: string, input: ZoneUpdateInput) => patch(`/zones/${id}`, ZoneChangeDto, input),
  createContainer: (zoneId: string, input: Partial<ContainerCreateInput>) =>
    post(`/zones/${zoneId}/containers`, ContainerDto, input),
  createContainers: (zoneId: string, input: Partial<ContainerBatchInput>) =>
    post(`/zones/${zoneId}/containers/batch`, ContainerDto.array(), input),
  updateContainer: (id: string, input: ContainerUpdateInput) =>
    patch(`/containers/${id}`, ContainerChangeDto, input),
  createRack: (containerId: string, input: Partial<RackCreateInput>) =>
    post(`/containers/${containerId}/racks`, RackDto, input),
  createRacks: (containerId: string, input: Partial<RackBatchInput>) =>
    post(`/containers/${containerId}/racks/batch`, RackDto.array(), input),
  updateRack: (id: string, input: RackUpdateInput) => patch(`/racks/${id}`, RackChangeDto, input),
  setActive: (kind: NodeKind, id: string, active: boolean) =>
    post(`/${NODE_PATH[kind]}/${id}/${active ? 'reactivate' : 'deactivate'}`, {
      parse: (v: unknown) => v,
    }),
  remove: (kind: NodeKind, id: string) =>
    apiFetch<void>(`${API}/${NODE_PATH[kind]}/${id}`, { method: 'DELETE' }),
};

export function labelsSearch(scope: LabelScope, ids: readonly string[]): string {
  const params = new URLSearchParams({ scope });
  if (scope !== 'warehouse') params.set('ids', ids.join(','));
  return params.toString();
}

export function useLocationLabels(
  warehouseId: string | undefined,
  scope: LabelScope,
  ids: readonly string[],
) {
  return useQuery({
    queryKey: ['location-labels', warehouseId, scope, ids],
    queryFn: ({ signal }) =>
      apiFetch(`${API}/warehouses/${warehouseId}/labels?${labelsSearch(scope, ids)}`, {
        schema: LocationLabelDto.array(),
        signal,
      }),
    enabled: !!warehouseId && (scope === 'warehouse' || ids.length > 0),
  });
}
