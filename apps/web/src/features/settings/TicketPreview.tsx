import { type BranchDto, formatMoney } from '@warehouse-manager/shared';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PrintLayout, usePrint } from '@/shared/print/PrintLayout';
import { TicketFooter } from '@/shared/ticket/TicketFooter';
import {
  TICKET_CONTENT_WIDTH,
  type TicketBranch,
  TicketHeader,
  type TicketWidth,
} from '@/shared/ticket/TicketHeader';
import { Button } from '@/shared/ui/button';
import { previewTotals } from './previewTotals';

export type PreviewBranch = TicketBranch &
  Pick<BranchDto, 'code' | 'timezone' | 'taxRateBp' | 'pricesIncludeTax'>;

/** Partidas ficticias del ticket de ejemplo (spec F5 §3). */
const SAMPLE_LINES = [
  { name: 'Zapato de piel dama', detail: '25 Negro', quantity: 1, unitPrice: 89900 },
  { name: 'Cinturón de piel', detail: null, quantity: 1, unitPrice: 34900 },
];

/** "03/10/2026, 18:30" en la zona horaria de la sucursal. */
export function formatTicketDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
}

/** `1600` → `"16"`, `1650` → `"16.5"`. */
export const formatPercent = (bp: number) => String(bp / 100);

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <p className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(cents)}</span>
    </p>
  );
}

const Rule = () => <hr className="my-1 border-dashed border-black" />;

interface SampleTicketProps {
  branch: PreviewBranch;
  cashier: string;
  width: TicketWidth;
  now: Date;
}

/** Ticket de ejemplo: encabezado y pie reales de la sucursal con un cuerpo ficticio. */
function SampleTicket({ branch, cashier, width, now }: SampleTicketProps) {
  const totals = previewTotals(SAMPLE_LINES, branch.taxRateBp, branch.pricesIncludeTax);
  const cash = Math.ceil(totals.total / 10000) * 10000;
  return (
    <div
      className="flex flex-col gap-1 font-mono text-[11px] leading-snug text-black"
      style={{ width: TICKET_CONTENT_WIDTH[width] }}
    >
      <p className="text-center">— Vista previa —</p>
      <TicketHeader branch={branch} width={width} />
      <Rule />
      <p>Folio {branch.code}-000000</p>
      <p>{formatTicketDateTime(now, branch.timezone)}</p>
      <p>Cajero: {cashier}</p>
      <Rule />
      {SAMPLE_LINES.map((line) => (
        <div key={line.name}>
          <p>{line.name}</p>
          <p className="flex justify-between gap-2">
            <span>{line.detail}</span>
            <span className="tabular-nums">
              {line.quantity} x {formatMoney(line.unitPrice)}
            </span>
          </p>
        </div>
      ))}
      <Rule />
      {branch.pricesIncludeTax ? (
        <>
          <Row label="Total" cents={totals.total} />
          <Row label="IVA incluido" cents={totals.tax} />
        </>
      ) : (
        <>
          <Row label="Subtotal" cents={totals.subtotal} />
          <Row label={`IVA ${formatPercent(branch.taxRateBp)} %`} cents={totals.tax} />
          <Row label="Total" cents={totals.total} />
        </>
      )}
      <Row label="Efectivo" cents={cash} />
      <Row label="Cambio" cents={cash - totals.total} />
      <Rule />
      <TicketFooter branch={branch} width={width} />
    </div>
  );
}

export interface TicketPreviewProps {
  /** Valores del formulario sin guardar: la vista previa cambia mientras se escribe. */
  branch: PreviewBranch;
  cashier: string;
  /** Momento que muestra el ticket (por defecto, ahora). */
  now?: Date;
}

/** Vista previa del ticket en 80 o 58 mm, con "Imprimir prueba" (spec F5 §3). */
export function TicketPreview({ branch, cashier, now = new Date() }: TicketPreviewProps) {
  const [width, setWidth] = useState<TicketWidth>(80);
  const [printing, setPrinting] = useState(false);
  const print = usePrint();

  // El ticket se monta en #print-root solo mientras se imprime.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing, print]);

  const ticket = <SampleTicket branch={branch} cashier={cashier} width={width} now={now} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Ancho del papel" className="flex gap-1">
          {([80, 58] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={width === option ? 'default' : 'outline'}
              aria-pressed={width === option}
              onClick={() => setWidth(option)}
            >
              {option} mm
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setPrinting(true)}>
          <Printer />
          Imprimir prueba
        </Button>
      </div>
      <div
        data-testid="ticket-preview"
        className="flex justify-center overflow-x-auto rounded-md border bg-white p-3"
      >
        {ticket}
      </div>
      {printing && (
        <PrintLayout size={width === 80 ? 'ticket-80' : 'ticket-58'}>{ticket}</PrintLayout>
      )}
    </div>
  );
}
