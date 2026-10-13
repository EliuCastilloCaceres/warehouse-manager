import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { makeSession } from '@/test/fixtures';
import { jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { BRANCH_URL, makeBranch } from './testing';
import { formatTicketDateTime, type PreviewBranch, TicketPreview } from './TicketPreview';

const LOGO = '/uploads/branch/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.webp';
const NOW = new Date('2026-10-13T00:30:00.000Z');
const preview = () => screen.getByTestId('ticket-preview');

function branch(overrides: Partial<PreviewBranch> = {}): PreviewBranch {
  return { ...makeBranch(), ...overrides };
}

describe('TicketPreview: mientras se escribe (T20)', () => {
  it('muestra los cambios del formulario antes de guardar', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
      [`GET ${BRANCH_URL}`]: () => jsonResponse(200, makeBranch({ logoUrl: LOGO })),
    });
    const app = renderApp('/settings/branch');

    // Pegar en lugar de teclear: cada tecla vuelve a dibujar el formulario y la vista previa.
    const replace = async (label: string, text: string) => {
      const input = await screen.findByLabelText(label);
      await app.user.clear(input);
      await app.user.click(input);
      await app.user.paste(text);
    };
    await replace('Nombre', 'Zapatería Norte');
    await replace('Encabezado', 'Abierto de 9 a 21');
    await replace('Mensaje final', 'Vuelve pronto');

    const ticket = within(preview());
    expect(ticket.getByText('Zapatería Norte')).toBeInTheDocument();
    expect(ticket.getByText('Abierto de 9 a 21')).toBeInTheDocument();
    expect(ticket.getByText('Vuelve pronto')).toBeInTheDocument();
    expect(ticket.getByRole('img', { name: 'Logo de Zapatería Norte' })).toHaveAttribute(
      'src',
      LOGO,
    );
    expect(ticket.getByText('— Vista previa —')).toBeInTheDocument();
    expect(ticket.getByText('Folio S1-000000')).toBeInTheDocument();
    expect(ticket.getByText('Cajero: Eliu Castillo')).toBeInTheDocument();
  });
});

describe('TicketPreview: totales y fecha (T22)', () => {
  const row = (label: string) => within(preview()).getByText(label).closest('p');

  it('con IVA incluido muestra "Total" e "IVA incluido"', () => {
    render(<TicketPreview branch={branch()} cashier="Eliu Castillo" now={NOW} />);
    expect(row('Total')).toHaveTextContent('$1,248.00');
    expect(row('IVA incluido')).toHaveTextContent('$172.14');
    expect(within(preview()).queryByText('Subtotal')).not.toBeInTheDocument();
    expect(row('Efectivo')).toHaveTextContent('$1,300.00');
    expect(row('Cambio')).toHaveTextContent('$52.00');
  });

  it('sin IVA incluido muestra "Subtotal", "IVA 16 %" y "Total"', () => {
    render(
      <TicketPreview
        branch={branch({ pricesIncludeTax: false })}
        cashier="Eliu Castillo"
        now={NOW}
      />,
    );
    expect(row('Subtotal')).toHaveTextContent('$1,248.00');
    expect(row('IVA 16 %')).toHaveTextContent('$199.68');
    expect(row('Total')).toHaveTextContent('$1,447.68');
    expect(within(preview()).queryByText('IVA incluido')).not.toBeInTheDocument();
  });

  it.each([
    ['America/Mexico_City', '18:30'],
    ['America/Tijuana', '17:30'],
  ])('la fecha usa la zona del formulario (%s)', (timezone, time) => {
    render(<TicketPreview branch={branch({ timezone })} cashier="Eliu Castillo" now={NOW} />);
    const text = formatTicketDateTime(NOW, timezone);
    expect(text).toContain('12/10/2026');
    expect(text).toContain(time);
    expect(within(preview()).getByText(text)).toBeInTheDocument();
  });
});

describe('TicketPreview: ancho e impresión (T24)', () => {
  const content = () => preview().firstElementChild as HTMLElement;

  it('el selector cambia el ancho a 72 o 48 mm', async () => {
    render(<TicketPreview branch={branch()} cashier="Eliu Castillo" now={NOW} />);
    expect(content()).toHaveStyle({ width: '72mm' });
    expect(screen.getByRole('button', { name: '80 mm' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '58 mm' }));
    expect(content()).toHaveStyle({ width: '48mm' });
    expect(screen.getByRole('button', { name: '58 mm' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['80 mm', 'ticket-80'],
    ['58 mm', 'ticket-58'],
  ])('"Imprimir prueba" en %s monta PrintLayout %s y llama a window.print', async (label, size) => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    render(<TicketPreview branch={branch()} cashier="Eliu Castillo" now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: label }));
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir prueba' }));

    const root = document.getElementById(PRINT_ROOT_ID)!;
    expect(root.querySelector(`[data-print-size="${size}"]`)).not.toBeNull();
    expect(within(root).getByText('Folio S1-000000')).toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(root.querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });
});
