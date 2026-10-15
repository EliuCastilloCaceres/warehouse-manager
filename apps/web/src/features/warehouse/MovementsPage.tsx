import {
  ADJUSTMENT_REASON_LABELS,
  InventoryMovementType,
  type MovementListQuery,
  type MovementRowDto,
} from '@warehouse-manager/shared';
import { useId, useMemo, useState } from 'react';
import { useDebouncedValue } from '@/features/users/useDebouncedValue';
import { formatDateTime } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { DataTable, type DataTableColumn } from '@/shared/ui/DataTable';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { useMovements } from './api';
import { MOVEMENT_TYPE_LABELS } from './components';
import { BackLink } from './WarehouseHomePage';

export const MOVEMENTS_PAGE_SIZE = 20;
export const DATE_RANGE_MESSAGE = '"Hasta" debe ser igual o posterior a "Desde"';

export interface MovementFilters {
  sku: string;
  locationCode: string;
  types: InventoryMovementType[];
  userId: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: MovementFilters = {
  sku: '',
  locationCode: '',
  types: [],
  userId: '',
  from: '',
  to: '',
};

/** Filtros de la pantalla → `MovementListQuery` (los vacíos no se envían). */
export function toMovementQuery(f: MovementFilters, page: number): Partial<MovementListQuery> {
  return {
    page,
    pageSize: MOVEMENTS_PAGE_SIZE,
    sku: f.sku.trim() || undefined,
    locationCode: f.locationCode.trim() || undefined,
    types: f.types.length > 0 ? f.types : undefined,
    userId: f.userId || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
  };
}

const ALL_USERS = 'all';

const columnsFor = (timeZone: string): DataTableColumn<MovementRowDto>[] => [
  {
    key: 'date',
    header: 'Fecha',
    cell: (m) => formatDateTime(m.createdAt, timeZone),
  },
  { key: 'type', header: 'Tipo', cell: (m) => MOVEMENT_TYPE_LABELS[m.type] },
  {
    key: 'sku',
    header: 'SKU',
    cell: (m) => (
      <span className="flex flex-col">
        <span className="font-mono">{m.sku}</span>
        <span className="text-xs text-muted-foreground">
          {m.productName}
          {m.variantLabel && ` · ${m.variantLabel}`}
        </span>
      </span>
    ),
  },
  {
    key: 'route',
    header: 'De → a',
    cell: (m) => `${m.fromLocationCode ?? '—'} → ${m.toLocationCode ?? '—'}`,
  },
  { key: 'quantity', header: 'Cantidad', cell: (m) => m.quantity },
  { key: 'user', header: 'Usuario', cell: (m) => m.user.fullName },
  {
    key: 'reason',
    header: 'Motivo y nota',
    cell: (m) =>
      [m.adjustmentReason && ADJUSTMENT_REASON_LABELS[m.adjustmentReason], m.note]
        .filter(Boolean)
        .join(' · '),
  },
];

/** `/warehouse/movements`: kardex de la sucursal con filtros (spec F7 §8). */
export function MovementsPage() {
  const ids = { sku: useId(), location: useId(), user: useId(), from: useId(), to: useId() };
  const [filters, setFilters] = useState<MovementFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const sku = useDebouncedValue(filters.sku);
  const locationCode = useDebouncedValue(filters.locationCode);
  const rangeInvalid = !!filters.from && !!filters.to && filters.from > filters.to;
  const [applied, setApplied] = useState<Partial<MovementListQuery>>(
    toMovementQuery(EMPTY_FILTERS, 1),
  );
  const next = toMovementQuery({ ...filters, sku, locationCode }, page);
  if (!rangeInvalid && JSON.stringify(next) !== JSON.stringify(applied)) setApplied(next);
  const movements = useMovements(applied);

  const set = (patch: Partial<MovementFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const toggleType = (type: InventoryMovementType) =>
    set({
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });

  const users = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of movements.data?.items ?? []) seen.set(m.user.id, m.user.fullName);
    return [...seen];
  }, [movements.data]);
  const columns = useMemo(
    () => columnsFor(movements.data?.timezone ?? 'America/Mexico_City'),
    [movements.data?.timezone],
  );
  const total = movements.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / MOVEMENTS_PAGE_SIZE));

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">Kardex</h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={ids.sku}>SKU</Label>
          <Input id={ids.sku} value={filters.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.location}>Ubicación</Label>
          <Input
            id={ids.location}
            placeholder="A-01-03"
            value={filters.locationCode}
            onChange={(e) => set({ locationCode: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.user}>Usuario</Label>
          <Select
            value={filters.userId || ALL_USERS}
            onValueChange={(value) => set({ userId: value === ALL_USERS ? '' : value })}
          >
            <SelectTrigger id={ids.user} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_USERS}>Todos</SelectItem>
              {users.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.from}>Desde</Label>
          <Input
            id={ids.from}
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.to}>Hasta</Label>
          <Input
            id={ids.to}
            type="date"
            value={filters.to}
            aria-invalid={rangeInvalid}
            onChange={(e) => set({ to: e.target.value })}
          />
          {rangeInvalid && <p className="text-sm text-destructive">{DATE_RANGE_MESSAGE}</p>}
        </div>
      </div>

      <div role="group" aria-label="Tipo" className="flex flex-wrap gap-2">
        {InventoryMovementType.options.map((type) => (
          <Button
            key={type}
            size="sm"
            variant={filters.types.includes(type) ? 'default' : 'outline'}
            aria-pressed={filters.types.includes(type)}
            onClick={() => toggleType(type)}
          >
            {MOVEMENT_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>

      <DataTable
        label="Movimientos"
        columns={columns}
        rows={movements.data?.items}
        rowKey={(m) => m.id}
        loading={movements.isPending}
        error={movements.error}
        onRetry={() => void movements.refetch()}
        emptyMessage="No hay movimientos con esos filtros."
      />

      {total > MOVEMENTS_PAGE_SIZE && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Siguiente
          </Button>
        </nav>
      )}
    </section>
  );
}
