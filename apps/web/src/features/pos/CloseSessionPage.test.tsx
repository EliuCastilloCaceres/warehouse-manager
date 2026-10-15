import { screen, waitFor, within } from '@testing-library/react';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  ANA,
  closeKey,
  JUAN,
  makeCloseSummary,
  makeSessionDto,
  ok,
  posRoutes,
  RELEASE_ALL_KEY,
  saveDeviceRegister,
  sessionKey,
} from './testing';

const pending = () =>
  apiError(409, 'CASH_SESSION_HAS_OPEN_CARTS', 'Hay carritos con productos reservados.', {
    carts: [
      {
        id: 'ca770000-0000-4000-8000-000000000001',
        number: 3,
        owner: JUAN,
        label: null,
        unitCount: 3,
      },
      {
        id: 'ca770000-0000-4000-8000-000000000002',
        number: 5,
        owner: ANA,
        label: 'Rojo',
        unitCount: 1,
      },
    ],
  });

function start(close: Parameters<typeof mockFetch>[0][string]) {
  saveDeviceRegister();
  return mockFetch(
    posRoutes({
      [sessionKey()]: ok(makeSessionDto()),
      [closeKey()]: close,
      [RELEASE_ALL_KEY]: ok({ releasedCarts: 2 }),
    }),
  );
}

describe('CloseSessionPage (T34)', () => {
  it('el paso 1 solo pide el efectivo contado; después muestra esperado, contado y diferencia', async () => {
    const fetchMock = start(ok(makeCloseSummary()));
    const app = renderApp('/pos/close');
    expect(
      await screen.findByText('Paso 1 · Cuenta el efectivo de la caja Caja 1'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Esperado/)).not.toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Cerrar caja' });
    expect(close).toBeDisabled();
    await app.user.type(screen.getByLabelText('Efectivo contado'), '5,680');
    await app.user.click(close);

    await waitFor(() => expect(callsTo(fetchMock, closeKey())).toHaveLength(1));
    const [, init] = callsTo(fetchMock, closeKey())[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ countedAmount: 568000 });
    const result = await screen.findByRole('region', { name: 'Resultado del corte' });
    expect(result).toHaveTextContent(
      'Fondo $500.00 · Ventas 12 ($8,450.00) · Canceladas 1 ($349.00)',
    );
    expect(result).toHaveTextContent(
      'Efectivo $5,200.00 · Tarjeta $2,750.00 · Transferencia $500.00',
    );
    expect(result).toHaveTextContent('Esperado $5,700.00 · Contado $5,680.00');
    const difference = within(result).getByTestId('difference');
    expect(difference).toHaveTextContent('Diferencia −$20.00');
    expect(difference).toHaveClass('text-destructive');
  });

  it('con carritos pendientes los lista y libera todo antes de cerrar', async () => {
    const fetchMock = start([pending, ok(makeCloseSummary({ difference: 500 }))]);
    const app = renderApp('/pos/close');
    await app.user.type(await screen.findByLabelText('Efectivo contado'), '5700');
    await app.user.click(screen.getByRole('button', { name: 'Cerrar caja' }));

    const alert = await screen.findByText(/carritos con productos reservados/);
    expect(alert).toHaveTextContent(
      '2 carritos con productos reservados: Juan (3 pzas), Ana (1 pza)',
    );
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(
      within(box).getByRole('button', { name: 'Regresar todo a su ubicación' }),
    ).toBeInTheDocument();
    await app.user.click(within(box).getByRole('button', { name: 'Enviar todo a staging' }));

    await waitFor(() => expect(callsTo(fetchMock, closeKey())).toHaveLength(2));
    const [, init] = callsTo(fetchMock, RELEASE_ALL_KEY)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ releaseTo: 'STAGING' });
    const difference = await screen.findByTestId('difference');
    expect(difference).toHaveTextContent('Diferencia $5.00');
    expect(difference).not.toHaveClass('text-destructive');
  });
});
