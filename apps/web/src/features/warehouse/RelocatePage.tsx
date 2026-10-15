import type { NodeContentDto } from '@warehouse-manager/shared';
import { useState } from 'react';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { notify } from '@/shared/ui/notify';
import { inventoryApi, useInvalidateStock } from './api';
import {
  NOT_A_LOCATION_MESSAGE,
  PROMO_SCAN_MESSAGE,
  QuantityStepper,
  useCapacityGuard,
} from './components';
import { locationCodeOf, type ResolvedRack, useScanLookups } from './scanFlow';
import { LOCATION_NOT_FOUND } from './SearchPage';
import { BackLink } from './WarehouseHomePage';

export const SAME_RACK_MESSAGE = 'El destino debe ser distinto del origen';

type Origin = NodeContentDto;

/** `/warehouse/relocate`: origen → productos (o "Todo") → destino → confirmar (spec F7 §8). */
export function RelocatePage() {
  const lookups = useScanLookups();
  const invalidate = useInvalidateStock();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [destination, setDestination] = useState<ResolvedRack | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [all, setAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const movable = origin?.items.filter((row) => row.available > 0) ?? [];
  const items = Object.entries(selected).map(([variantId, quantity]) => ({ variantId, quantity }));

  const reset = () => {
    setOrigin(null);
    setDestination(null);
    setSelected({});
    setAll(false);
  };

  const onScan = async (scan: ValidScan) => {
    setMessage(null);
    if (scan.kind === 'promo') return setMessage(PROMO_SCAN_MESSAGE);
    const code = locationCodeOf(scan);
    if (!code) return setMessage(NOT_A_LOCATION_MESSAGE);
    if (!origin) {
      try {
        setOrigin(await inventoryApi.byLocation(code));
      } catch {
        setMessage(LOCATION_NOT_FOUND);
      }
      return;
    }
    if (code === origin.node.code) return setMessage(SAME_RACK_MESSAGE);
    const found = await lookups.rack(code);
    if (!found) return setMessage(LOCATION_NOT_FOUND);
    setDestination(found);
  };

  const guard = useCapacityGuard(
    async (overrideCapacity) => {
      await inventoryApi.relocate({
        fromRackId: origin!.node.id,
        toRackId: destination!.id,
        overrideCapacity,
        ...(all ? { all: true } : { items }),
      });
      notify.success(`Reubicado de ${origin!.node.code} a ${destination!.locationCode}`);
      await invalidate();
      reset();
    },
    () => setDestination(null),
  );

  const toggle = (variantId: string, available: number, checked: boolean) =>
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[variantId] = available;
      else delete next[variantId];
      return next;
    });

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">Reubicar</h1>
      <ScanInput
        label="Escanear ubicación"
        captureHid
        onScan={(scan) => void onScan(scan).catch(notify.error)}
      />
      <p className="text-sm text-muted-foreground">
        {!origin
          ? 'Escanea el origen.'
          : destination
            ? 'Revisa y confirma.'
            : 'Elige los productos y escanea el destino.'}
      </p>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {origin && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p>
              Origen: <span className="font-mono font-semibold">{origin.node.code}</span>
            </p>
            <Button variant="outline" onClick={reset}>
              Cambiar origen
            </Button>
          </div>
          {movable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay unidades disponibles para mover.</p>
          ) : (
            <>
              <Button
                variant={all ? 'default' : 'outline'}
                aria-pressed={all}
                className="h-14"
                onClick={() => setAll(!all)}
              >
                Todo
              </Button>
              <ul
                aria-label="Productos del origen"
                className="flex flex-col divide-y rounded-md border"
              >
                {movable.map((row) => {
                  const checked = all || row.variantId in selected;
                  return (
                    <li key={row.variantId} className="flex flex-col gap-2 p-3">
                      <label className="flex min-h-11 items-center gap-3">
                        <Checkbox
                          aria-label={`Mover ${row.sku}`}
                          checked={checked}
                          disabled={all}
                          onCheckedChange={(value) => toggle(row.variantId, row.available, !!value)}
                        />
                        <span className="flex flex-col">
                          <span className="font-mono text-sm">{row.sku}</span>
                          <span className="text-sm">
                            {row.productName}
                            {row.variantLabel && ` · ${row.variantLabel}`} · {row.available}{' '}
                            disponibles
                            {row.reservedQty > 0 && ` (${row.reservedQty} en piso se quedan)`}
                          </span>
                        </span>
                      </label>
                      {!all && row.variantId in selected && (
                        <QuantityStepper
                          label={`Cantidad de ${row.sku}`}
                          value={selected[row.variantId]!}
                          max={row.available}
                          onChange={(quantity) =>
                            setSelected((current) => ({ ...current, [row.variantId]: quantity }))
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {destination && (
        <p>
          Destino: <span className="font-mono font-semibold">{destination.locationCode}</span>
        </p>
      )}
      <Button
        className="h-14"
        disabled={!origin || !destination || (!all && items.length === 0) || guard.busy}
        onClick={() => void guard.submit()}
      >
        Confirmar
      </Button>
      {guard.dialog}
    </section>
  );
}
