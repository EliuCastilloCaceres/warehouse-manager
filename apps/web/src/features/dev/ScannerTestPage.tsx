import { LOCATION_QR_PREFIX, toPromoQrPayload } from '@warehouse-manager/shared';
import { Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { DEFAULT_TIME_ZONE, formatTime } from '@/shared/format/date';
import { Barcode } from '@/shared/print/Barcode';
import { PrintLayout, usePrint } from '@/shared/print/PrintLayout';
import { QrCode } from '@/shared/print/QrCode';
import { ScanInput, type ScanSource, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { DataTable, type DataTableColumn } from '@/shared/ui/DataTable';

interface ScanLog {
  id: number;
  at: string;
  source: ScanSource;
  result: ValidScan;
}

const MAX_LOGS = 10;
const SAMPLE: ValidScan = { kind: 'product', code: 'ZAP0101-25-NEG' };

const SOURCE_LABEL: Record<ScanSource, string> = {
  camera: 'Cámara',
  hid: 'Lector',
  manual: 'Manual',
};
const KIND_LABEL: Record<ValidScan['kind'], string> = {
  product: 'Producto',
  location: 'Ubicación',
  promo: 'Promoción',
};

const scanText = (scan: ValidScan) => (scan.kind === 'promo' ? scan.text : scan.code);

const columns: DataTableColumn<ScanLog>[] = [
  { key: 'at', header: 'Hora', cell: (log) => formatTime(log.at, DEFAULT_TIME_ZONE) },
  { key: 'source', header: 'Origen', cell: (log) => SOURCE_LABEL[log.source] },
  { key: 'kind', header: 'Tipo', cell: (log) => KIND_LABEL[log.result.kind] },
  {
    key: 'code',
    header: 'Código',
    cell: (log) => <span className="font-mono">{scanText(log.result)}</span>,
  },
];

/** Código de barras (producto) o QR (ubicación y promoción) de una lectura. */
function CodePreview({ scan, className }: { scan: ValidScan; className?: string }) {
  if (scan.kind === 'product') return <Barcode value={scan.code} className={className} />;
  const payload =
    scan.kind === 'location' ? `${LOCATION_QR_PREFIX}${scan.code}` : toPromoQrPayload(scan.text);
  return <QrCode value={payload} className={className} />;
}

/** Etiqueta de 50×25 mm con el último código, para probar la Ribetec RT-420ME. */
function TestLabel({ scan }: { scan: ValidScan }) {
  if (scan.kind === 'product') {
    return (
      <div className="flex h-full items-center justify-center p-[2mm]">
        <Barcode value={scan.code} height={70} fontSize={18} className="max-h-full w-full" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center gap-[2mm] p-[2mm]">
      <CodePreview scan={scan} className="h-full" />
      <span className="min-w-0 break-all font-mono text-[4mm] font-bold leading-tight">
        {scanText(scan)}
      </span>
    </div>
  );
}

/** `/dev/scanner`: verificación en campo de la cámara, el lector y la impresora (spec F3 §4). */
export function ScannerTestPage() {
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const nextId = useRef(1);
  const print = usePrint();
  const last = logs[0]?.result;

  const onScan = (result: ValidScan, { source }: { source: ScanSource }) => {
    const log = { id: nextId.current++, at: new Date().toISOString(), source, result };
    setLogs((previous) => [log, ...previous].slice(0, MAX_LOGS));
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Prueba de escáner e impresión</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escanea con la cámara, con el lector o escribe un código. El lector funciona aunque el
          cursor no esté en el campo.
        </p>
      </div>

      <ScanInput onScan={onScan} captureHid continuous />

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Últimas lecturas</h2>
        <DataTable
          label="Últimas lecturas"
          columns={columns}
          rows={logs}
          rowKey={(log) => String(log.id)}
          emptyMessage="Aún no hay lecturas."
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-medium">{last ? 'Último código' : 'Código de ejemplo'}</h2>
        <div className="flex justify-center rounded-md border bg-white p-4">
          <CodePreview scan={last ?? SAMPLE} className="max-h-40 w-full max-w-xs" />
        </div>
        <Button variant="outline" className="self-start" onClick={print}>
          <Printer />
          Imprimir etiqueta de prueba
        </Button>
        <p className="text-xs text-muted-foreground">
          Etiqueta de 50×25 mm. En el diálogo de impresión elige la Ribetec RT-420ME, márgenes
          "Ninguno" y escala 100 %.
        </p>
      </div>

      <PrintLayout size="label-50x25">
        <TestLabel scan={last ?? SAMPLE} />
      </PrintLayout>
    </section>
  );
}
