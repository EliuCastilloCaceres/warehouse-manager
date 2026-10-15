import { screen, waitFor, within } from '@testing-library/react';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { BRANCH_S1 } from '@/test/fixtures';
import { mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { registerStorageKey } from '../device';
import {
  closeKey,
  makeCloseSummary,
  makeSessionDto,
  ok,
  posRoutes,
  saveDeviceRegister,
  sessionKey,
} from '../testing';

describe('CashCloseTicket (T35)', () => {
  it('"Imprimir corte" monta ticket-80 con todo el corte; la caja se olvida en el dispositivo', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    saveDeviceRegister();
    mockFetch(
      posRoutes({
        [sessionKey()]: ok(makeSessionDto()),
        [closeKey()]: ok(makeCloseSummary()),
      }),
    );
    const app = renderApp('/pos/close');
    await app.user.type(await screen.findByLabelText('Efectivo contado'), '5680');
    await app.user.click(screen.getByRole('button', { name: 'Cerrar caja' }));
    await screen.findByRole('region', { name: 'Resultado del corte' });
    expect(localStorage.getItem(registerStorageKey(BRANCH_S1.id))).toBeNull();

    await app.user.click(screen.getByRole('button', { name: 'Imprimir corte' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const root = document.getElementById(PRINT_ROOT_ID)!;
    expect(root.querySelector('[data-print-size="ticket-80"]')).not.toBeNull();
    const ticket = within(root).getByTestId('cash-close-ticket');
    const t = within(ticket);
    const row = (label: string) => t.getByText(label).closest('p');
    expect(t.getByText('Sucursal Centro')).toBeInTheDocument();
    expect(t.getByText('Corte de caja')).toBeInTheDocument();
    expect(t.getByText('C1 · Caja 1')).toBeInTheDocument();
    // 15:02 UTC = 09:02 y 02:00 UTC del 16 = 20:00 del 15 en la Ciudad de México.
    expect(t.getByText('Abrió: Luis Mora · 15/10/2026, 09:02')).toBeInTheDocument();
    expect(t.getByText('Cerró: Ana López · 15/10/2026, 20:00')).toBeInTheDocument();
    expect(row('Fondo')).toHaveTextContent('$500.00');
    expect(row('Ventas (12)')).toHaveTextContent('$8,450.00');
    expect(row('Canceladas (1)')).toHaveTextContent('$349.00');
    expect(row('Efectivo (8)')).toHaveTextContent('$5,200.00');
    expect(row('Tarjeta (3)')).toHaveTextContent('$2,750.00');
    expect(row('Transferencia (1)')).toHaveTextContent('$500.00');
    expect(row('Esperado')).toHaveTextContent('$5,700.00');
    expect(row('Contado')).toHaveTextContent('$5,680.00');
    expect(row('Diferencia')).toHaveTextContent('−$20.00');
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(root.querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });
});
