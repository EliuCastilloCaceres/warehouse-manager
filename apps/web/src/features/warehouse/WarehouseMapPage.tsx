import type {
  ContainerNodeDto,
  OccupancyDto,
  RackNodeDto,
  StockFilter,
  ZoneNodeDto,
} from '@warehouse-manager/shared';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/shared/api/errors';
import { CapacityBar } from '@/shared/ui/CapacityBar';
import { Button } from '@/shared/ui/button';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { useWarehouse, useWarehouseTree } from './api';
import { ColorDot, STOCK_FILTERS } from './components';
import { RackContent } from './RackContent';
import { BackLink } from './WarehouseHomePage';

const LEVEL_DOT: Record<OccupancyDto['level'], string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-600',
  none: 'bg-muted-foreground/40',
};

function Matches({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
      {count} {count === 1 ? 'coincide' : 'coinciden'}
    </span>
  );
}

function Header({
  color,
  title,
  occupancy,
  matchCount,
}: {
  color: string | null;
  title: string;
  occupancy: OccupancyDto;
  matchCount?: number;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <ColorDot hex={color} />
        <span className="font-medium">{title}</span>
        <span
          aria-hidden
          className={cn('inline-block size-2.5 rounded-full', LEVEL_DOT[occupancy.level])}
        />
        <Matches count={matchCount} />
      </div>
      <CapacityBar
        label={`Ocupación de ${title}`}
        used={occupancy.occupied}
        capacity={occupancy.capacity}
      />
    </div>
  );
}

function RackButton({ rack, onOpen }: { rack: RackNodeDto; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Rack ${rack.locationCode}`}
      onClick={onOpen}
      className={cn(
        'flex min-h-14 flex-col gap-1 rounded-md border p-2 text-left hover:bg-muted/50',
        !rack.isActive && 'opacity-60',
      )}
    >
      <span className="flex items-center gap-1.5">
        <ColorDot hex={rack.colorHex} />
        <span className="font-mono text-sm">{rack.locationCode}</span>
        <Matches count={rack.matchCount} />
      </span>
      <CapacityBar
        label={`Ocupación de ${rack.locationCode}`}
        used={rack.occupancy.occupied}
        capacity={rack.occupancy.capacity}
      />
    </button>
  );
}

function ContainerNode({
  zone,
  container,
  onOpenRack,
}: {
  zone: ZoneNodeDto;
  container: ContainerNodeDto;
  onOpenRack: (rack: RackNodeDto) => void;
}) {
  const code = `${zone.code}-${container.code}`;
  return (
    <details open className="rounded-md border">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 p-2">
        <Header
          color={zone.color}
          title={container.name ? `${code} · ${container.name}` : code}
          occupancy={container.occupancy}
          matchCount={container.matchCount}
        />
      </summary>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
        {container.racks.map((rack) => (
          <RackButton key={rack.id} rack={rack} onOpen={() => onOpenRack(rack)} />
        ))}
      </div>
    </details>
  );
}

/** `/warehouse/map`: ocupación por zona, contenedor y rack, con filtros por estado (spec F7 §8). */
export function WarehouseMapPage() {
  const { warehouse, error: warehouseError } = useWarehouse();
  const [status, setStatus] = useState<StockFilter | undefined>();
  const [open, setOpen] = useState<{ id: string; code: string } | null>(null);
  const tree = useWarehouseTree(warehouse?.id, { status });

  const error = warehouseError ?? tree.error;
  if (error)
    return <ErrorState message={errorMessage(error)} onRetry={() => void tree.refetch()} />;
  if (!tree.data) return <LoadingState />;
  const { totals, staging, zones } = tree.data;

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">{tree.data.warehouse.name}</h1>

      <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {STOCK_FILTERS.map(([value, label]) => (
          <Button
            key={value}
            variant={status === value ? 'default' : 'outline'}
            aria-pressed={status === value}
            onClick={() => setStatus(status === value ? undefined : value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="mb-1 font-medium">Total</p>
          <CapacityBar label="Ocupación total" used={totals.occupied} capacity={totals.capacity} />
        </div>
        <button
          type="button"
          aria-label={`Staging ${staging.locationCode}`}
          className="rounded-md border p-3 text-left hover:bg-muted/50"
          onClick={() => setOpen({ id: staging.rackId, code: staging.locationCode })}
        >
          <p className="mb-1 flex items-center gap-2 font-medium">
            Staging: {staging.occupied} pzas <Matches count={staging.matchCount} />
          </p>
          <CapacityBar
            label="Ocupación de staging"
            used={staging.occupied}
            capacity={0}
            unlimited
          />
        </button>
      </div>

      <ul aria-label="Zonas" className="flex flex-col gap-3">
        {zones.map((zone) => (
          <li key={zone.id}>
            <details open className="rounded-md border">
              <summary className="flex min-h-12 cursor-pointer items-center gap-2 p-3">
                <Header
                  color={zone.color}
                  title={`${zone.code} · ${zone.name}`}
                  occupancy={zone.occupancy}
                  matchCount={zone.matchCount}
                />
              </summary>
              <div className="flex flex-col gap-2 p-2">
                {zone.containers.map((container) => (
                  <ContainerNode
                    key={container.id}
                    zone={zone}
                    container={container}
                    onOpenRack={(rack) => setOpen({ id: rack.id, code: rack.locationCode })}
                  />
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>

      <ResponsiveDialog
        open={!!open}
        onOpenChange={(value) => !value && setOpen(null)}
        title={open ? `Contenido de ${open.code}` : 'Contenido'}
      >
        {open && <RackContent node={{ kind: 'rack', id: open.id }} status={status} />}
      </ResponsiveDialog>
    </section>
  );
}
