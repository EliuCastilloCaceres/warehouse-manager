import { type LocateVariantDto, variantLabel } from '@warehouse-manager/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Can } from '@/features/auth/guards';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { type AdjustTarget, AdjustDialog } from './AdjustDialog';
import { inventoryApi } from './api';
import { ColorDot, PROMO_SCAN_MESSAGE, StockBadges } from './components';
import { RackContent } from './RackContent';
import { BackLink } from './WarehouseHomePage';

export const PRODUCT_NOT_FOUND = 'No se encontró el producto';
export const LOCATION_NOT_FOUND = 'No existe esa ubicación en la sucursal';

type Variant = LocateVariantDto['variant'];

const targetOf = (variant: Variant, rack: { id: string; locationCode: string }): AdjustTarget => ({
  variant: { id: variant.id, sku: variant.sku, label: variantLabel(variant) },
  rack,
});

function VariantStock({
  productName,
  item,
  onAdjust,
}: {
  productName: string;
  item: LocateVariantDto;
  onAdjust: (target: AdjustTarget) => void;
}) {
  const label = variantLabel(item.variant);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {productName}
          {label && ` · ${label}`} <span className="font-mono text-sm">{item.variant.sku}</span>
        </p>
        <StockBadges stock={item.stock} />
      </div>
      <p className="text-sm text-muted-foreground">
        {item.totals.quantity} pzas en la sucursal · {item.totals.available} disponibles
      </p>

      {item.locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin unidades en esta sucursal.</p>
      ) : (
        <ul aria-label="Ubicaciones" className="flex flex-col divide-y rounded-md border">
          {item.locations.map((location) => (
            <li key={location.rackId} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <ColorDot hex={location.colorHex} />
              <span className="font-mono font-medium">{location.locationCode}</span>
              <span className="flex-1 text-sm">
                {location.quantity} pzas
                {location.reservedQty > 0 && ` (${location.reservedQty} en piso)`}
                {location.isStaging && ' (staging)'}
              </span>
              <Can perm="inventory.adjust">
                <Button
                  variant="outline"
                  onClick={() =>
                    onAdjust(
                      targetOf(item.variant, {
                        id: location.rackId,
                        locationCode: location.locationCode,
                      }),
                    )
                  }
                >
                  Ajustar
                </Button>
              </Can>
            </li>
          ))}
        </ul>
      )}

      {item.otherBranches && (
        <section aria-label="En otras sucursales" className="flex flex-col gap-1">
          <h2 className="font-medium">En otras sucursales</h2>
          {item.otherBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay disponibles en otras sucursales.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {item.otherBranches.map((branch) => (
                <li key={branch.branchId}>
                  {[branch.name, branch.phone, `${branch.available} disponibles`]
                    .filter(Boolean)
                    .join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * `/warehouse/search`: dónde está un producto (y, con permiso, cuánto hay en otras sucursales) o
 * qué hay en una ubicación. Con `?mode=adjust`, elegida la variante, escanear una ubicación abre
 * el ajuste ahí.
 */
export function SearchPage() {
  const [params] = useSearchParams();
  const adjustMode = params.get('mode') === 'adjust';
  const [code, setCode] = useState<string | null>(null);
  const [rackId, setRackId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<AdjustTarget | null>(null);

  const located = useQuery({
    queryKey: ['locate', code],
    queryFn: () => inventoryApi.locate(code!),
    enabled: !!code,
  });
  const variants = located.data?.variants ?? [];
  const selected =
    variants.find((v) => v.variant.id === chosen) ?? (variants.length === 1 ? variants[0] : null);

  const onScan = async (scan: ValidScan) => {
    setMessage(null);
    if (scan.kind === 'promo') {
      setMessage(PROMO_SCAN_MESSAGE);
      return;
    }
    if (scan.kind === 'product') {
      setCode(scan.code);
      setChosen(null);
      setRackId(null);
      return;
    }
    try {
      const content = await inventoryApi.byLocation(scan.code);
      const rack = { id: content.node.id, locationCode: content.node.code };
      if (adjustMode && selected) {
        setAdjusting(targetOf(selected.variant, rack));
      } else {
        setRackId(rack.id);
        setCode(null);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') setMessage(LOCATION_NOT_FOUND);
      else notify.error(error);
    }
  };

  const notFound = located.error instanceof ApiError && located.error.code === 'NOT_FOUND';

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">{adjustMode ? 'Ajustar inventario' : 'Buscar'}</h1>
      <ScanInput
        label="Escanear producto o ubicación"
        placeholder="Escanea o escribe un SKU"
        captureHid
        onScan={(scan) => void onScan(scan)}
      />
      {adjustMode && (
        <p className="text-sm text-muted-foreground">
          {selected
            ? 'Toca "Ajustar" en una ubicación o escanea otra para ajustar ahí.'
            : 'Escanea el producto que quieres ajustar.'}
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {code && located.isPending && <LoadingState />}
      {notFound && (
        <p role="alert" className="text-sm text-destructive">
          {PRODUCT_NOT_FOUND}
        </p>
      )}
      {located.error && !notFound && (
        <ErrorState message={errorMessage(located.error)} onRetry={() => void located.refetch()} />
      )}

      {located.data && !selected && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{located.data.product.name}: elige la variante</p>
          <ul aria-label="Variantes" className="flex flex-col gap-2">
            {variants.map(({ variant, totals }) => (
              <li key={variant.id}>
                <Button
                  variant="outline"
                  className="h-14 w-full justify-between"
                  onClick={() => setChosen(variant.id)}
                >
                  <span>
                    <span className="font-mono">{variant.sku}</span> {variantLabel(variant)}
                  </span>
                  <span className="text-muted-foreground">{totals.quantity} pzas</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {located.data && selected && (
        <>
          {variants.length > 1 && (
            <Button variant="link" className="self-start px-0" onClick={() => setChosen(null)}>
              Ver todas las variantes
            </Button>
          )}
          <VariantStock
            productName={located.data.product.name}
            item={selected}
            onAdjust={setAdjusting}
          />
        </>
      )}

      {rackId && <RackContent node={{ kind: 'rack', id: rackId }} />}
      <AdjustDialog target={adjusting} onClose={() => setAdjusting(null)} />
    </section>
  );
}
