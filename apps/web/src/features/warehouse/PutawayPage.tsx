import {
  type LocateResultDto,
  type LocateVariantDto,
  type PutawaySource,
  type SuggestionDto,
  variantLabel,
} from '@warehouse-manager/shared';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { inventoryApi, useInvalidateStock } from './api';
import {
  ColorDot,
  NOT_A_PRODUCT_MESSAGE,
  PROMO_SCAN_MESSAGE,
  QuantityStepper,
  useCapacityGuard,
} from './components';
import { locationCodeOf, type ResolvedRack, stagingAvailable, useScanLookups } from './scanFlow';
import { LOCATION_NOT_FOUND, PRODUCT_NOT_FOUND } from './SearchPage';
import { BackLink } from './WarehouseHomePage';

export const STAGING_DESTINATION_MESSAGE = 'El destino no puede ser staging';

const REASON_TEXT: Record<SuggestionDto['reason'], string> = {
  SAME_VARIANT: ' · ya está aquí',
  SAME_PRODUCT: ' · mismo producto',
  FREE_SPACE: '',
};

interface Picked {
  productName: string;
  item: LocateVariantDto;
}

const describe = ({ productName, item }: Picked) => {
  const label = variantLabel(item.variant);
  return `${productName}${label ? ` · ${label}` : ''}`;
};

function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Variantes del resultado para elegir una (escaneo de un SKU padre). */
function ChooseVariant({
  result,
  onChoose,
}: {
  result: LocateResultDto;
  onChoose: (item: LocateVariantDto) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{result.product.name}: elige la variante</p>
      <ul aria-label="Variantes" className="flex flex-col gap-2">
        {result.variants.map((item) => (
          <li key={item.variant.id}>
            <Button
              variant="outline"
              className="h-14 w-full justify-start"
              onClick={() => onChoose(item)}
            >
              <span className="font-mono">{item.variant.sku}</span> {variantLabel(item.variant)}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcePicker({
  source,
  inStaging,
  onChange,
}: {
  source: PutawaySource;
  inStaging: number;
  onChange: (source: PutawaySource) => void;
}) {
  const options: [PutawaySource, string, boolean][] = [
    ['STAGING', `Desde staging (${inStaging})`, inStaging === 0],
    ['NEW', 'Mercancía nueva', false],
  ];
  return (
    <div role="group" aria-label="Origen" className="grid grid-cols-2 gap-2">
      {options.map(([value, text, disabled]) => (
        <Button
          key={value}
          type="button"
          variant={source === value ? 'default' : 'outline'}
          aria-pressed={source === value}
          className="h-14 whitespace-normal"
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

/** "Producto primero": producto → (variante) → ubicación sugerida o escaneada → cantidad → origen. */
function ProductFirst({ initialSku }: { initialSku: string | null }) {
  const lookups = useScanLookups();
  const invalidate = useInvalidateStock();
  const [result, setResult] = useState<LocateResultDto | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [rack, setRack] = useState<ResolvedRack | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [source, setSource] = useState<PutawaySource>('NEW');
  const [message, setMessage] = useState<string | null>(null);

  const inStaging = picked ? stagingAvailable(picked.item) : 0;
  const suggestions = useQuery({
    queryKey: ['suggest', picked?.item.variant.id, quantity],
    queryFn: () => inventoryApi.suggest(picked!.item.variant.id, quantity),
    enabled: !!picked && !rack,
  });

  const pick = (productName: string, item: LocateVariantDto) => {
    const staging = stagingAvailable(item);
    setPicked({ productName, item });
    setResult(null);
    setRack(null);
    setSource(staging > 0 ? 'STAGING' : 'NEW');
    setQuantity(staging > 0 ? staging : 1);
  };

  const onScan = async (scan: ValidScan) => {
    setMessage(null);
    if (scan.kind === 'promo') return setMessage(PROMO_SCAN_MESSAGE);
    if (scan.kind === 'location' && !picked) return setMessage(NOT_A_PRODUCT_MESSAGE);
    // Con el producto elegido, el código tecleado sin `LOC:` ("A-01-03") también es el destino.
    const location = picked ? locationCodeOf(scan) : null;
    if (location) {
      const found = await lookups.rack(location);
      if (!found) return setMessage(LOCATION_NOT_FOUND);
      if (found.isStaging) return setMessage(STAGING_DESTINATION_MESSAGE);
      return setRack(found);
    }
    const found = await lookups.locate(scan.code);
    if (!found) return setMessage(PRODUCT_NOT_FOUND);
    show(found);
  };

  const show = (found: LocateResultDto) => {
    if (found.variants.length === 1) pick(found.product.name, found.variants[0]!);
    else {
      setPicked(null);
      setResult(found);
    }
  };

  // Desde Staging (`?sku=`): se elige la variante en cuanto llega su búsqueda.
  const initial = useQuery({
    queryKey: ['locate', initialSku],
    queryFn: () => inventoryApi.locate(initialSku!),
    enabled: !!initialSku,
  });
  const [initialShown, setInitialShown] = useState(false);
  if (initial.data && !initialShown) {
    setInitialShown(true);
    show(initial.data);
  }

  const guard = useCapacityGuard(
    async (overrideCapacity) => {
      await inventoryApi.putaway({
        variantId: picked!.item.variant.id,
        rackId: rack!.id,
        quantity,
        source,
        overrideCapacity,
      });
      notify.success(`Ubicado: ${quantity} × ${picked!.item.variant.sku} en ${rack!.locationCode}`);
      await invalidate();
      setPicked(null);
      setRack(null);
    },
    () => setRack(null),
  );

  return (
    <div className="flex flex-col gap-4">
      <ScanInput
        label="Escanear producto o ubicación"
        captureHid
        onScan={(scan) => void onScan(scan).catch(notify.error)}
      />
      <Alert message={message} />
      {result && (
        <ChooseVariant result={result} onChoose={(item) => pick(result.product.name, item)} />
      )}

      {picked && (
        <>
          <p className="font-medium">
            {describe(picked)} <span className="font-mono text-sm">{picked.item.variant.sku}</span>
          </p>

          {rack ? (
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <span>
                Destino: <span className="font-mono font-semibold">{rack.locationCode}</span>
              </span>
              <Button variant="outline" onClick={() => setRack(null)}>
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Toca una sugerencia o escanea una ubicación.
              </p>
              {suggestions.data && !suggestions.data.fitsAll && (
                <p className="text-sm text-amber-700">
                  Ningún rack tiene espacio para {quantity}; estos son los de más espacio libre.
                </p>
              )}
              <ul aria-label="Sugerencias" className="flex flex-col gap-2">
                {suggestions.data?.suggestions.map((s) => (
                  <li key={s.rackId}>
                    <Button
                      variant="outline"
                      className="h-14 w-full justify-start gap-2"
                      onClick={() =>
                        setRack({ id: s.rackId, locationCode: s.locationCode, isStaging: false })
                      }
                    >
                      <ColorDot hex={s.colorHex} />
                      {`${s.locationCode} · ${s.free} libres${REASON_TEXT[s.reason]}`}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            max={source === 'STAGING' ? Math.max(1, inStaging) : undefined}
          />
          <SourcePicker
            source={source}
            inStaging={inStaging}
            onChange={(next) => {
              setSource(next);
              if (next === 'STAGING') setQuantity((q) => Math.min(q, Math.max(1, inStaging)));
            }}
          />
          <Button
            className="h-14"
            disabled={!rack || guard.busy}
            onClick={() => void guard.submit()}
          >
            Confirmar
          </Button>
        </>
      )}
      {guard.dialog}
    </div>
  );
}

interface BatchRow {
  variantId: string;
  sku: string;
  description: string;
  quantity: number;
  source: PutawaySource;
  inStaging: number;
}

/** "Ubicación primero": la ubicación y luego los productos sin parar; se confirma en lote. */
function LocationFirst() {
  const lookups = useScanLookups();
  const invalidate = useInvalidateStock();
  const [rack, setRack] = useState<ResolvedRack | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [choosing, setChoosing] = useState<LocateResultDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const add = (productName: string, item: LocateVariantDto) => {
    setChoosing(null);
    setRows((current) => {
      const existing = current.find((r) => r.variantId === item.variant.id);
      if (existing) {
        return current.map((r) => (r === existing ? { ...r, quantity: r.quantity + 1 } : r));
      }
      const inStaging = stagingAvailable(item);
      return [
        ...current,
        {
          variantId: item.variant.id,
          sku: item.variant.sku,
          description: describe({ productName, item }),
          quantity: 1,
          source: inStaging > 0 ? 'STAGING' : 'NEW',
          inStaging,
        },
      ];
    });
  };

  const onScan = async (scan: ValidScan) => {
    setMessage(null);
    if (scan.kind === 'promo') return setMessage(PROMO_SCAN_MESSAGE);
    // Sin ubicación todavía, el código tecleado sin `LOC:` ("A-01-03") también es la ubicación.
    const location = scan.kind === 'location' || !rack ? locationCodeOf(scan) : null;
    if (location) {
      const found = await lookups.rack(location);
      if (!found) return setMessage(LOCATION_NOT_FOUND);
      if (found.isStaging) return setMessage(STAGING_DESTINATION_MESSAGE);
      return setRack(found);
    }
    if (!rack) return setMessage('Escanea primero la ubicación');
    const found = await lookups.locate(scan.code);
    if (!found) return setMessage(PRODUCT_NOT_FOUND);
    if (found.variants.length === 1) add(found.product.name, found.variants[0]!);
    else setChoosing(found);
  };

  const update = (variantId: string, patch: Partial<BatchRow>) =>
    setRows((current) => current.map((r) => (r.variantId === variantId ? { ...r, ...patch } : r)));

  const guard = useCapacityGuard(async (overrideCapacity) => {
    await inventoryApi.putawayBatch({
      rackId: rack!.id,
      overrideCapacity,
      items: rows.map(({ variantId, quantity, source }) => ({ variantId, quantity, source })),
    });
    const units = rows.reduce((sum, r) => sum + r.quantity, 0);
    notify.success(`Ubicadas ${units} pzas en ${rack!.locationCode}`);
    await invalidate();
    setRows([]);
  });

  return (
    <div className="flex flex-col gap-4">
      <ScanInput
        label="Escanear ubicación o producto"
        captureHid
        continuous
        onScan={(scan) => void onScan(scan).catch(notify.error)}
      />
      <Alert message={message} />
      {rack ? (
        <p>
          Ubicación: <span className="font-mono font-semibold">{rack.locationCode}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Escanea la ubicación.</p>
      )}
      {choosing && (
        <ChooseVariant result={choosing} onChoose={(item) => add(choosing.product.name, item)} />
      )}

      {rows.length > 0 && (
        <ul aria-label="Productos a ubicar" className="flex flex-col divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.variantId} className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="font-mono text-sm">{row.sku}</span>
                  <br />
                  {row.description}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar ${row.sku}`}
                  onClick={() =>
                    setRows((current) => current.filter((r) => r.variantId !== row.variantId))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <QuantityStepper
                label={`Cantidad de ${row.sku}`}
                value={row.quantity}
                onChange={(quantity) => update(row.variantId, { quantity })}
              />
              <SourcePicker
                source={row.source}
                inStaging={row.inStaging}
                onChange={(source) => update(row.variantId, { source })}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        className="h-14"
        disabled={!rack || rows.length === 0 || guard.busy}
        onClick={() => void guard.submit()}
      >
        Confirmar lote
      </Button>
      {guard.dialog}
    </div>
  );
}

/** `/warehouse/putaway`: ubicar "producto primero" o "ubicación primero" (spec F7 §8). */
export function PutawayPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'location' ? 'location' : 'product';
  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">Ubicar</h1>
      <div role="group" aria-label="Modo" className="grid grid-cols-2 gap-2">
        {(
          [
            ['product', 'Producto primero'],
            ['location', 'Ubicación primero'],
          ] as const
        ).map(([value, text]) => (
          <Button
            key={value}
            variant={mode === value ? 'default' : 'outline'}
            aria-pressed={mode === value}
            className="h-14"
            onClick={() => setParams(value === 'location' ? { mode: 'location' } : {})}
          >
            {text}
          </Button>
        ))}
      </div>
      {mode === 'product' ? <ProductFirst initialSku={params.get('sku')} /> : <LocationFirst />}
    </section>
  );
}
