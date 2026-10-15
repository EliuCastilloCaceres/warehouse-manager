import {
  type CashSessionSummaryDto,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  type TicketBranchDto,
} from '@warehouse-manager/shared';
import { formatTicketDateTime } from '@/features/settings/TicketPreview';
import { DEFAULT_TIME_ZONE } from '@/shared/format/date';
import { TICKET_CONTENT_WIDTH } from '@/shared/ticket/TicketHeader';

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <p className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(cents)}</span>
    </p>
  );
}

const Rule = () => <hr className="my-1 border-dashed border-black" />;

/**
 * Corte impreso a 80 mm (spec F8 §7): caja, quién abrió y cerró y cuándo, fondo, ventas,
 * canceladas, desglose por método, esperado, contado y diferencia.
 */
export function CashCloseTicket({
  summary,
  branch,
}: {
  summary: CashSessionSummaryDto;
  branch: Pick<TicketBranchDto, 'name' | 'timezone'> | null;
}) {
  const { session } = summary;
  const timeZone = branch?.timezone ?? DEFAULT_TIME_ZONE;
  const date = (iso: string | null) => (iso ? formatTicketDateTime(new Date(iso), timeZone) : '');
  return (
    <div
      data-testid="cash-close-ticket"
      className="flex flex-col gap-1 font-mono text-[11px] leading-snug text-black"
      style={{ width: TICKET_CONTENT_WIDTH[80] }}
    >
      {branch && <p className="text-center font-bold">{branch.name}</p>}
      <p className="text-center font-bold">Corte de caja</p>
      <p className="text-center">
        {session.cashRegister.code} · {session.cashRegister.name}
      </p>
      <Rule />
      <p>
        Abrió: {session.openedBy.fullName} · {date(session.openedAt)}
      </p>
      <p>
        Cerró: {session.closedBy?.fullName ?? ''} · {date(session.closedAt)}
      </p>
      <Rule />
      <Row label="Fondo" cents={session.openingAmount} />
      <Row label={`Ventas (${summary.salesCount})`} cents={summary.salesTotal} />
      <Row label={`Canceladas (${summary.cancelledCount})`} cents={summary.cancelledTotal} />
      <Rule />
      {summary.byMethod.map((row) => (
        <Row
          key={row.method}
          label={`${PAYMENT_METHOD_LABELS[row.method]} (${row.count})`}
          cents={row.amount}
        />
      ))}
      <Rule />
      <Row label="Esperado" cents={summary.expectedAmount} />
      <Row label="Contado" cents={summary.countedAmount} />
      <p className="flex justify-between gap-2 font-bold">
        <span>Diferencia</span>
        <span className="tabular-nums">
          {summary.difference < 0 ? '−' : ''}
          {formatMoney(Math.abs(summary.difference))}
        </span>
      </p>
    </div>
  );
}
