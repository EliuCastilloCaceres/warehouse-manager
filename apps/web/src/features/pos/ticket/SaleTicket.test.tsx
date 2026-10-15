import { render, screen, within } from '@testing-library/react';
import { formatTicketDateTime } from '@/features/settings/TicketPreview';
import { makeTicket, makeTicketBranch } from '../testing';
import { SaleTicket } from './SaleTicket';

const ticketEl = () => screen.getByTestId('sale-ticket');
const row = (label: string) => within(ticketEl()).getByText(label).closest('p');

describe('SaleTicket (T31)', () => {
  it('encabezado y pie de la sucursal, folio, fecha, caja, vendedor, cajero y cliente', () => {
    const ticket = makeTicket();
    render(<SaleTicket ticket={ticket} width={80} />);
    const t = within(ticketEl());
    for (const text of [
      'Sucursal Centro',
      'Calzado del Centro SA de CV',
      'RFC: CAL010101AB1',
      'Av. Juárez 10',
      'Tel. 55 0000 1111',
      'Abierto de 9 a 21',
      'Folio S1-000001',
      'Caja: C1 · Caja 1',
      'Le atendió: Ana López',
      'Cajero: Eliu Castillo',
      'Cliente: María',
      'Gracias por su compra',
      'DESC10',
      'Muestra este QR al cajero en tu próxima compra',
    ]) {
      expect(t.getByText(text)).toBeInTheDocument();
    }
    expect(t.getByRole('img', { name: 'PROMO:DESC10' })).toBeInTheDocument();
    // 00:30 UTC del 15 = 18:30 del 14 en la Ciudad de México.
    expect(t.getByText('14/10/2026, 18:30')).toBeInTheDocument();
  });

  it('la fecha usa la zona de la sucursal', () => {
    const ticket = makeTicket({ branch: makeTicketBranch({ timezone: 'America/Tijuana' }) });
    render(<SaleTicket ticket={ticket} width={80} />);
    const text = formatTicketDateTime(new Date(ticket.sale.createdAt), 'America/Tijuana');
    expect(text).toBe('14/10/2026, 17:30');
    expect(within(ticketEl()).getByText(text)).toBeInTheDocument();
  });

  it('partidas con descuento, totales con IVA incluido y pagos con recibido, cambio y referencia', () => {
    render(<SaleTicket ticket={makeTicket()} width={80} />);
    const t = within(ticketEl());
    expect(t.getByText('Zapato de piel dama')).toBeInTheDocument();
    expect(t.getByText('25 · Negro').closest('p')).toHaveTextContent('1 x $899.00');
    expect(row('Descuento')).toHaveTextContent('−$100.00');
    expect(t.getByText('$799.00')).toBeInTheDocument();
    expect(t.getByText('CIN0001').closest('p')).toHaveTextContent('1 x $349.00');
    expect(row('Subtotal')).toHaveTextContent('$1,248.00');
    expect(row('Descuentos')).toHaveTextContent('−$100.00');
    expect(row('Total')).toHaveTextContent('$1,148.00');
    expect(row('IVA incluido')).toHaveTextContent('$158.34');
    expect(t.queryByText(/^IVA \d/)).not.toBeInTheDocument();
    expect(row('Efectivo')).toHaveTextContent('$848.00');
    expect(row('Recibido')).toHaveTextContent('$900.00');
    expect(row('Cambio')).toHaveTextContent('$52.00');
    expect(row('Tarjeta')).toHaveTextContent('$300.00');
    expect(t.getByText('Ref. AUT-123')).toBeInTheDocument();
  });

  it('sin IVA incluido: "IVA 16 %" antes del total', () => {
    const base = makeTicket();
    const ticket = makeTicket({
      sale: { ...base.sale, pricesIncludeTax: false, taxTotal: 18368, total: 133168 },
    });
    render(<SaleTicket ticket={ticket} width={80} />);
    expect(row('IVA 16 %')).toHaveTextContent('$183.68');
    expect(row('Total')).toHaveTextContent('$1,331.68');
    expect(within(ticketEl()).queryByText('IVA incluido')).not.toBeInTheDocument();
  });

  it('una venta cancelada muestra "*** CANCELADA ***" con el motivo, quién y cuándo', () => {
    const base = makeTicket();
    const ticket = makeTicket({
      sale: {
        ...base.sale,
        status: 'CANCELLED',
        cancelledAt: '2026-10-15T01:00:00.000Z',
        cancelledById: 'dddddddd-0000-4000-8000-000000000001',
        cancelReason: 'Error de captura',
      },
      cancelledBy: { id: 'dddddddd-0000-4000-8000-000000000001', fullName: 'Gerente S1' },
    });
    render(<SaleTicket ticket={ticket} width={80} />);
    const t = within(ticketEl());
    expect(t.getByText('*** CANCELADA ***')).toBeInTheDocument();
    expect(t.getByText('Motivo: Error de captura')).toBeInTheDocument();
    expect(t.getByText('Canceló: Gerente S1 · 14/10/2026, 19:00')).toBeInTheDocument();
  });

  it('el ancho cambia entre 80 y 58 mm', () => {
    const { rerender } = render(<SaleTicket ticket={makeTicket()} width={80} />);
    expect(ticketEl()).toHaveStyle({ width: '72mm' });
    rerender(<SaleTicket ticket={makeTicket()} width={58} />);
    expect(ticketEl()).toHaveStyle({ width: '48mm' });
  });
});
