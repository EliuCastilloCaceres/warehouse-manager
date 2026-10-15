import { formatMoney, PAYMENT_METHOD_LABELS, type SaleTicketDto } from '@warehouse-manager/shared';
import { formatPercent, formatTicketDateTime } from '@/features/settings/TicketPreview';
import { TicketFooter } from '@/shared/ticket/TicketFooter';
import { TICKET_CONTENT_WIDTH, TicketHeader, type TicketWidth } from '@/shared/ticket/TicketHeader';

function Row({ label, cents, negative }: { label: string; cents: number; negative?: boolean }) {
  return (
    <p className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums">
        {negative ? '−' : ''}
        {formatMoney(cents)}
      </span>
    </p>
  );
}

const Rule = () => <hr className="my-1 border-dashed border-black" />;

/**
 * Ticket de una venta (spec F8 §3): encabezado y pie de la sucursal (F5), folio, fecha en la
 * zona de la sucursal, caja, vendedor y cajero, partidas, totales, pagos y, si se canceló,
 * "*** CANCELADA ***" con el motivo, quién y cuándo. 72 mm (papel de 80) o 48 mm (de 58).
 */
export function SaleTicket({ ticket, width }: { ticket: SaleTicketDto; width: TicketWidth }) {
  const { sale, branch } = ticket;
  const date = (iso: string) => formatTicketDateTime(new Date(iso), branch.timezone);
  return (
    <div
      data-testid="sale-ticket"
      className="flex flex-col gap-1 font-mono text-[11px] leading-snug text-black"
      style={{ width: TICKET_CONTENT_WIDTH[width] }}
    >
      <TicketHeader branch={branch} width={width} />
      <Rule />
      {sale.status === 'CANCELLED' && (
        <div className="flex flex-col items-center text-center">
          <p className="font-bold">*** CANCELADA ***</p>
          <p>Motivo: {sale.cancelReason}</p>
          <p>
            Canceló: {ticket.cancelledBy?.fullName} · {date(sale.cancelledAt!)}
          </p>
          <Rule />
        </div>
      )}
      <p>Folio {sale.folio}</p>
      <p>{date(sale.createdAt)}</p>
      <p>
        Caja: {ticket.cashRegister.code} · {ticket.cashRegister.name}
      </p>
      <p>Le atendió: {ticket.seller.fullName}</p>
      <p>Cajero: {ticket.cashier.fullName}</p>
      {sale.customerName && <p>Cliente: {sale.customerName}</p>}
      <Rule />
      {ticket.items.map((item) => (
        <div key={item.id}>
          <p>{item.nameSnapshot}</p>
          <p className="flex justify-between gap-2">
            <span>{item.variantLabelSnapshot ?? item.skuSnapshot}</span>
            <span className="tabular-nums">
              {item.quantity} x {formatMoney(item.unitPrice)}
            </span>
          </p>
          {item.discount > 0 && <Row label="Descuento" cents={item.discount} negative />}
          <p className="text-right tabular-nums">{formatMoney(item.lineTotal)}</p>
        </div>
      ))}
      <Rule />
      <Row label="Subtotal" cents={sale.subtotal} />
      {sale.discountTotal > 0 && <Row label="Descuentos" cents={sale.discountTotal} negative />}
      {sale.pricesIncludeTax ? (
        <>
          <Row label="Total" cents={sale.total} />
          <Row label="IVA incluido" cents={sale.taxTotal} />
        </>
      ) : (
        <>
          <Row label={`IVA ${formatPercent(sale.taxRateBp)} %`} cents={sale.taxTotal} />
          <Row label="Total" cents={sale.total} />
        </>
      )}
      {ticket.payments.length > 0 && <Rule />}
      {ticket.payments.map((payment) => (
        <div key={payment.id}>
          <Row label={PAYMENT_METHOD_LABELS[payment.method]} cents={payment.amount} />
          {payment.received !== null && <Row label="Recibido" cents={payment.received} />}
          {payment.change !== null && <Row label="Cambio" cents={payment.change} />}
          {payment.reference && <p>Ref. {payment.reference}</p>}
        </div>
      ))}
      <Rule />
      <TicketFooter branch={branch} width={width} />
    </div>
  );
}
