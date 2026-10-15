import {
  colorName,
  type InventoryMovementType,
  type StockFilter,
  type StockStatusDto,
} from '@warehouse-manager/shared';
import { Minus, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { ApiError } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';

export const STOCK_FILTERS: readonly (readonly [StockFilter, string])[] = [
  ['AGOTADO', 'Agotado'],
  ['BAJO', 'Bajo'],
  ['EN_PISO', 'En piso'],
  ['EN_STAGING', 'Staging'],
];

const STATUS_LABEL: Record<StockStatusDto['status'], string> = {
  DISPONIBLE: 'Disponible',
  BAJO: 'Bajo',
  AGOTADO: 'Agotado',
};

const STATUS_CLASS: Record<StockStatusDto['status'], string> = {
  DISPONIBLE: 'bg-emerald-100 text-emerald-900',
  BAJO: 'bg-amber-100 text-amber-900',
  AGOTADO: 'bg-red-100 text-red-900',
};

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  INITIAL_LOAD: 'Carga inicial',
  PUTAWAY: 'Ubicación',
  RELOCATE: 'Reubicación',
  PICK: 'Al piso',
  RETURN_TO_RACK: 'Regreso al rack',
  TO_STAGING: 'A staging',
  SALE: 'Venta',
  SALE_CANCEL: 'Cancelación de venta',
  ADJUSTMENT_IN: 'Ajuste de entrada',
  ADJUSTMENT_OUT: 'Ajuste de salida',
};

export const PROMO_SCAN_MESSAGE = 'Este código es de una promoción, no de un producto';
export const NOT_A_LOCATION_MESSAGE = 'Escanea el código de una ubicación';
export const NOT_A_PRODUCT_MESSAGE = 'Escanea el código de un producto';

/** Estado de la variante en la sucursal ("Bajo") y sus banderas ("En piso", "En staging"). */
export function StockBadges({ stock }: { stock: StockStatusDto }) {
  return (
    <span className="inline-flex flex-wrap gap-1 text-xs">
      <span className={cn('rounded px-1.5 py-0.5 font-medium', STATUS_CLASS[stock.status])}>
        {STATUS_LABEL[stock.status]}
      </span>
      {stock.enPiso && (
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-900">En piso</span>
      )}
      {stock.enStaging && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">En staging</span>
      )}
    </span>
  );
}

/** Banda de color de la ubicación, con su nombre para lectores de pantalla. */
export function ColorDot({ hex }: { hex: string | null }) {
  return (
    <span
      role="img"
      aria-label={hex ? `Color ${colorName(hex) ?? hex}` : 'Sin color'}
      data-color={hex ?? ''}
      className="inline-block size-4 shrink-0 rounded-sm border"
      style={{ backgroundColor: hex ?? 'transparent' }}
    />
  );
}

/** Cantidad con botones grandes de − y + (uso con una mano). */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  label = 'Cantidad',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const id = useId();
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="size-14"
        aria-label={`Menos (${label})`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus />
      </Button>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        inputMode="numeric"
        className="h-14 w-20 text-center text-lg"
        value={String(value)}
        onChange={(event) => {
          const n = Number.parseInt(event.target.value, 10);
          onChange(Number.isNaN(n) ? min : clamp(n));
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="size-14"
        aria-label={`Más (${label})`}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus />
      </Button>
    </div>
  );
}

export interface CapacityDetails {
  locationCode: string;
  capacity: number;
  occupied: number;
}

/** `details` de un `RACK_CAPACITY_EXCEEDED`, o `null` si el error es otro. */
export function capacityDetails(error: unknown): CapacityDetails | null {
  if (!(error instanceof ApiError) || error.code !== 'RACK_CAPACITY_EXCEEDED') return null;
  const details = (error.details ?? {}) as Partial<CapacityDetails>;
  return {
    locationCode: details.locationCode ?? '',
    capacity: details.capacity ?? 0,
    occupied: details.occupied ?? 0,
  };
}

/** "A-01-02 no tiene espacio (38/40, entran 2)". */
export function capacityMessage({ locationCode, capacity, occupied }: CapacityDetails): string {
  const free = Math.max(0, capacity - occupied);
  return `${locationCode} no tiene espacio (${occupied}/${capacity}, entran ${free})`;
}

/**
 * Envía una operación de stock; si el rack no tiene espacio, muestra el aviso. Con
 * `inventory.override_capacity`, "Exceder capacidad" la reintenta con `overrideCapacity`.
 */
export function useCapacityGuard(
  send: (overrideCapacity: boolean) => Promise<void>,
  onChooseOther?: () => void,
) {
  const { can } = useAuth();
  const [exceeded, setExceeded] = useState<CapacityDetails | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (overrideCapacity: boolean) => {
    setBusy(true);
    try {
      await send(overrideCapacity);
      setExceeded(null);
    } catch (error) {
      const details = capacityDetails(error);
      if (details) setExceeded(details);
      else notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <ResponsiveDialog
      open={!!exceeded}
      onOpenChange={(open) => !open && setExceeded(null)}
      title="Capacidad excedida"
      description={exceeded ? capacityMessage(exceeded) : undefined}
      footer={
        <>
          <Button
            variant="outline"
            className="h-14"
            onClick={() => {
              setExceeded(null);
              onChooseOther?.();
            }}
          >
            Elegir otra ubicación
          </Button>
          {can('inventory.override_capacity') && (
            <Button className="h-14" onClick={() => void run(true)}>
              Exceder capacidad
            </Button>
          )}
        </>
      }
    />
  );

  return { submit: () => run(false), busy, dialog };
}
