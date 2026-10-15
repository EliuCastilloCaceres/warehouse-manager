import type { LabelScope, LocationLabelDto } from '@warehouse-manager/shared';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chunk } from '@/features/products/LabelTemplates';
import { errorMessage } from '@/shared/api/errors';
import { PrintLayout, usePrint } from '@/shared/print/PrintLayout';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { LoadingState } from '@/shared/ui/states';
import { useLocationLabels, useWarehouse, useWarehouseTree } from './api';
import {
  LOCATION_LABEL_FORMATS,
  LOCATION_LABELS_PER_SHEET,
  LocationLabel4x6,
  LocationLabel50x25,
  type LocationLabelFormat,
  LocationLabelSheet,
} from './LocationLabelTemplates';
import { BackLink } from './WarehouseHomePage';

const SCOPES: readonly (readonly [LabelScope, string])[] = [
  ['warehouse', 'Almacén'],
  ['zone', 'Zona'],
  ['container', 'Contenedor'],
  ['rack', 'Rack'],
];

const isSheet = (format: LocationLabelFormat): format is 'a4' | 'letter' =>
  format === 'a4' || format === 'letter';

function LabelsView({
  labels,
  format,
}: {
  labels: readonly LocationLabelDto[];
  format: LocationLabelFormat;
}) {
  if (isSheet(format)) {
    return (
      <>
        {chunk(labels, LOCATION_LABELS_PER_SHEET).map((sheet, i) => (
          <LocationLabelSheet key={i} labels={sheet} format={format} />
        ))}
      </>
    );
  }
  const Template = format === 'label-4x6' ? LocationLabel4x6 : LocationLabel50x25;
  return (
    <>
      {labels.map((label) => (
        <div
          key={label.rackId}
          data-testid="location-label"
          className={format === 'label-4x6' ? 'h-[6in] w-[4in]' : 'h-[25mm] w-[50mm]'}
        >
          <Template label={label} />
        </div>
      ))}
    </>
  );
}

/** Impresión: en las térmicas una página por etiqueta; las hojas van juntas. */
function PrintLabels({
  labels,
  format,
}: {
  labels: readonly LocationLabelDto[];
  format: LocationLabelFormat;
}) {
  if (isSheet(format)) {
    return (
      <PrintLayout size={format}>
        <LabelsView labels={labels} format={format} />
      </PrintLayout>
    );
  }
  const Template = format === 'label-4x6' ? LocationLabel4x6 : LocationLabel50x25;
  return (
    <>
      {labels.map((label) => (
        <PrintLayout key={label.rackId} size={format}>
          <Template label={label} />
        </PrintLayout>
      ))}
    </>
  );
}

/** `/warehouse/labels`: alcance, formato, vista previa e impresión (spec F7 §8). */
export function LocationLabelsPage() {
  const { warehouse } = useWarehouse();
  const tree = useWarehouseTree(warehouse?.id);
  const [scope, setScope] = useState<LabelScope>('warehouse');
  const [ids, setIds] = useState<string[]>([]);
  const [format, setFormat] = useState<LocationLabelFormat>('label-4x6');
  const [printing, setPrinting] = useState(false);
  const print = usePrint();
  const labels = useLocationLabels(warehouse?.id, scope, ids);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing, print]);

  const options: [string, string][] = !tree.data
    ? []
    : scope === 'zone'
      ? tree.data.zones.map((z) => [z.id, `${z.code} · ${z.name}`])
      : scope === 'container'
        ? tree.data.zones.flatMap((z) =>
            z.containers.map((c) => [c.id, `${z.code}-${c.code}`] as [string, string]),
          )
        : scope === 'rack'
          ? [
              ...tree.data.zones.flatMap((z) =>
                z.containers.flatMap((c) =>
                  c.racks.map((r) => [r.id, r.locationCode] as [string, string]),
                ),
              ),
              [tree.data.staging.rackId, tree.data.staging.locationCode],
            ]
          : [];

  const toggle = (id: string, checked: boolean) =>
    setIds((current) => (checked ? [...current, id] : current.filter((i) => i !== id)));

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">Etiquetas de ubicación</h1>

      <div role="group" aria-label="Alcance" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SCOPES.map(([value, text]) => (
          <Button
            key={value}
            variant={scope === value ? 'default' : 'outline'}
            aria-pressed={scope === value}
            onClick={() => {
              setScope(value);
              setIds([]);
            }}
          >
            {text}
          </Button>
        ))}
      </div>

      {scope !== 'warehouse' && (
        <ul aria-label="Elegir ubicaciones" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {options.map(([id, text]) => (
            <li key={id}>
              <label className="flex min-h-11 items-center gap-2 rounded-md border px-2">
                <Checkbox
                  checked={ids.includes(id)}
                  onCheckedChange={(value) => toggle(id, value === true)}
                />
                <span className="font-mono text-sm">{text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div role="group" aria-label="Formato" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LOCATION_LABEL_FORMATS.map(([value, text]) => (
          <Button
            key={value}
            variant={format === value ? 'default' : 'outline'}
            aria-pressed={format === value}
            onClick={() => setFormat(value)}
          >
            {text}
          </Button>
        ))}
      </div>

      <Button
        className="h-14"
        disabled={!labels.data || labels.data.length === 0}
        onClick={() => setPrinting(true)}
      >
        <Printer />
        Imprimir
      </Button>

      {labels.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(labels.error)}
        </p>
      )}
      {labels.isFetching && !labels.data && <LoadingState />}
      {labels.data && labels.data.length > 0 && (
        <div
          data-testid="location-labels-preview"
          className="flex flex-wrap gap-3 overflow-x-auto rounded-md border bg-muted/30 p-3"
        >
          <LabelsView labels={labels.data} format={format} />
        </div>
      )}

      {printing && labels.data && <PrintLabels labels={labels.data} format={format} />}
    </section>
  );
}
