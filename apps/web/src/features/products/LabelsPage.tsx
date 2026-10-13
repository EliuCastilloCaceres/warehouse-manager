import { type LabelDataDto, type VariantDetailDto, variantLabel } from '@warehouse-manager/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useDebouncedValue } from '@/features/users/useDebouncedValue';
import { ApiError } from '@/shared/api/errors';
import { PrintLayout, usePrint } from '@/shared/print/PrintLayout';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { LoadingState } from '@/shared/ui/states';
import { productsApi, useProduct, useProducts } from './api';
import {
  chunk,
  expandLabels,
  Label4x6,
  Label50x25,
  LABEL_FORMATS,
  type LabelFormat,
  LabelSheet,
  LABELS_PER_SHEET,
} from './LabelTemplates';
import { PRODUCT_NOT_FOUND, WRONG_CODE_MESSAGES } from './ProductsListPage';

interface LabelItem {
  variantId: string;
  sku: string;
  name: string;
  variant: string | null;
  quantity: number;
}

const itemOf = (productName: string, variant: VariantDetailDto): LabelItem => ({
  variantId: variant.id,
  sku: variant.sku,
  name: productName,
  variant: variantLabel(variant),
  quantity: 1,
});

/** Etiquetas de todas las unidades en el formato elegido. */
function LabelsView({
  labels,
  format,
  showPrice,
}: {
  labels: readonly LabelDataDto[];
  format: LabelFormat;
  showPrice: boolean;
}) {
  const copies = expandLabels(labels);
  if (format === 'a4' || format === 'letter') {
    return (
      <>
        {chunk(copies, LABELS_PER_SHEET).map((sheet, i) => (
          <LabelSheet key={i} labels={sheet} format={format} showPrice={showPrice} />
        ))}
      </>
    );
  }
  const Template = format === 'label-50x25' ? Label50x25 : Label4x6;
  return (
    <>
      {copies.map((label, i) => (
        <div
          key={i}
          data-testid="label"
          className={format === 'label-50x25' ? 'h-[25mm] w-[50mm]' : 'h-[6in] w-[4in]'}
        >
          <Template label={label} showPrice={showPrice} />
        </div>
      ))}
    </>
  );
}

/**
 * Impresión: en 50×25 y 4×6 cada copia va en su propio `PrintLayout` (una página por etiqueta);
 * las hojas A4 o Carta van juntas, una por página.
 */
function PrintLabels({
  labels,
  format,
  showPrice,
}: {
  labels: readonly LabelDataDto[];
  format: LabelFormat;
  showPrice: boolean;
}) {
  if (format === 'a4' || format === 'letter') {
    return (
      <PrintLayout size={format}>
        <LabelsView labels={labels} format={format} showPrice={showPrice} />
      </PrintLayout>
    );
  }
  const Template = format === 'label-50x25' ? Label50x25 : Label4x6;
  return (
    <>
      {expandLabels(labels).map((label, i) => (
        <PrintLayout key={i} size={format}>
          <Template label={label} showPrice={showPrice} />
        </PrintLayout>
      ))}
    </>
  );
}

/** `/products/labels`: variantes por escaneo o búsqueda, formato, vista previa e impresión. */
export function LabelsPage() {
  const [items, setItems] = useState<LabelItem[]>([]);
  const [format, setFormat] = useState<LabelFormat>('label-50x25');
  const [showPrice, setShowPrice] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const print = usePrint();
  const q = useDebouncedValue(search);
  const results = useProducts({ q, status: 'active', type: '', categoryId: '', page: 1 });
  const pickedProduct = useProduct(picked);

  const request = items.map(({ variantId, quantity }) => ({ variantId, quantity }));
  const labels = useQuery({
    queryKey: ['labels', request],
    queryFn: () => productsApi.labels({ items: request }),
    enabled: request.length > 0 && request.every((i) => i.quantity >= 1 && i.quantity <= 500),
  });

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing, print]);

  const add = (next: LabelItem[]) =>
    setItems((current) => [
      ...current,
      ...next.filter((item) => !current.some((c) => c.variantId === item.variantId)),
    ]);

  const onScan = async (scan: ValidScan) => {
    if (scan.kind !== 'product') {
      setMessage(WRONG_CODE_MESSAGES[scan.kind]);
      return;
    }
    setMessage(null);
    try {
      const result = await productsApi.lookup(scan.code);
      const variants = result.match === 'variant' ? [result.variant] : result.variants;
      const active = variants.filter((v) => v.isEffectivelyActive);
      if (active.length === 0) setMessage('El producto o la variante están inactivos');
      add(active.map((v) => itemOf(result.product.name, v)));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') setMessage(PRODUCT_NOT_FOUND);
      else notify.error(error);
    }
  };

  const setQuantity = (variantId: string, value: string) =>
    setItems((current) =>
      current.map((item) =>
        item.variantId === variantId ? { ...item, quantity: Number(value) || 0 } : item,
      ),
    );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          to="/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Productos
        </Link>
        <h1 className="text-xl font-semibold">Etiquetas</h1>
      </div>

      <ScanInput label="Escanear variante" onScan={(scan) => void onScan(scan)} />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar producto"
            placeholder="Buscar por SKU, nombre o marca"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {q && results.data && (
          <ul aria-label="Resultados" className="flex flex-col divide-y rounded-md border">
            {results.data.items.slice(0, 5).map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  className="min-h-11 w-full px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => setPicked(product.id)}
                >
                  <span className="font-mono">{product.sku}</span> · {product.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked &&
          (pickedProduct.data ? (
            <div className="flex flex-col gap-1 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{pickedProduct.data.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const product = pickedProduct.data!;
                    add(
                      product.variants
                        .filter((v) => v.isEffectivelyActive)
                        .map((v) => itemOf(product.name, v)),
                    );
                    setPicked(undefined);
                  }}
                >
                  Agregar todas
                </Button>
              </div>
              <ul aria-label="Variantes del producto" className="flex flex-col">
                {pickedProduct.data.variants
                  .filter((v) => v.isEffectivelyActive)
                  .map((variant) => (
                    <li
                      key={variant.id}
                      className="flex min-h-11 items-center justify-between gap-2"
                    >
                      <span>
                        <span className="font-mono">{variant.sku}</span> {variantLabel(variant)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Agregar ${variant.sku}`}
                        onClick={() => add([itemOf(pickedProduct.data!.name, variant)])}
                      >
                        Agregar
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <LoadingState />
          ))}
      </div>

      {items.length > 0 && (
        <ul aria-label="Etiquetas a imprimir" className="flex flex-col divide-y rounded-md border">
          {items.map((item) => (
            <li key={item.variantId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-mono">{item.sku}</span> {item.name}
                {item.variant && ` · ${item.variant}`}
              </span>
              <Label htmlFor={`qty-${item.variantId}`} className="sr-only">
                Cantidad de {item.sku}
              </Label>
              <Input
                id={`qty-${item.variantId}`}
                type="number"
                min={1}
                max={500}
                className="w-20"
                value={item.quantity || ''}
                onChange={(event) => setQuantity(item.variantId, event.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${item.sku}`}
                onClick={() =>
                  setItems((current) => current.filter((c) => c.variantId !== item.variantId))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-60 space-y-1">
          <Label htmlFor="label-format">Formato</Label>
          <Select value={format} onValueChange={(value) => setFormat(value as LabelFormat)}>
            <SelectTrigger id="label-format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LABEL_FORMATS.map(([value, text]) => (
                <SelectItem key={value} value={value}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(v === true)} />
          Mostrar precio
        </label>
        <Button disabled={!labels.data || items.length === 0} onClick={() => setPrinting(true)}>
          <Printer />
          Imprimir
        </Button>
      </div>

      {labels.isError && <p className="text-sm text-destructive">{labels.error.message}</p>}
      {labels.data && items.length > 0 && (
        <div
          data-testid="labels-preview"
          className="flex flex-wrap gap-3 overflow-x-auto rounded-md border bg-muted/30 p-3"
        >
          <LabelsView labels={labels.data} format={format} showPrice={showPrice} />
        </div>
      )}

      {printing && labels.data && (
        <PrintLabels labels={labels.data} format={format} showPrice={showPrice} />
      )}
    </section>
  );
}
