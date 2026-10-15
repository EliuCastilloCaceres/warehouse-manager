import { screen, waitFor, within } from '@testing-library/react';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { AUTO_PRINT_KEY, TICKET_WIDTH_KEY } from './device';
import {
  ANA,
  BELT,
  cartActionKey,
  cartKey,
  cartsKey,
  created,
  makeCart,
  makeItem,
  makeSessionDto,
  makeTicket,
  ok,
  posRoutes,
  saveDeviceRegister,
  SESSION_C1,
  sessionKey,
} from './testing';

const cart = makeCart([makeItem(), BELT()], { owner: ANA, userId: ANA.id, customerName: 'María' });
const url = `/pos/checkout/${cart.id}`;
const checkoutKey = cartActionKey(cart.id, 'checkout');
const ticket = makeTicket();

function start(routes: object = {}) {
  saveDeviceRegister();
  return mockFetch(
    posRoutes({
      [sessionKey()]: ok(makeSessionDto()),
      [cartKey(cart.id)]: ok(cart),
      [checkoutKey]: created(ticket),
      [cartsKey('mine')]: ok([]),
      ...routes,
    }),
  );
}

const bodyOf = (fetchMock: jest.Mock) =>
  JSON.parse((callsTo(fetchMock, checkoutKey)[0]![1] as RequestInit).body as string);

/** Verifica las dos piezas para cobrar sin la confirmación de faltantes. */
async function verifyAll(app: ReturnType<typeof renderApp>) {
  const field = await screen.findByLabelText('Verificar piezas (opcional)');
  await app.user.type(field, 'ZAP0101-25-NEG{Enter}');
  await app.user.type(field, 'CIN0001{Enter}');
  await screen.findByText('2 de 2 piezas verificadas');
}

describe('CheckoutPage: cobro (T30)', () => {
  it('muestra la caja, el carrito y su dueño; efectivo con cambio', async () => {
    const fetchMock = start();
    const app = renderApp(url);
    expect(
      await screen.findByText('Cobrando en Caja 1 · Carrito #12 de Ana López'),
    ).toBeInTheDocument();
    expect(screen.getByText('Total a cobrar').closest('p')).toHaveTextContent('$1,248.00');
    const confirm = screen.getByRole('button', { name: 'Confirmar cobro' });
    expect(confirm).toBeDisabled();

    await app.user.click(screen.getByRole('button', { name: 'Efectivo' }));
    expect(screen.getByRole('button', { name: '$1,250.00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$1,500.00' })).toBeInTheDocument();
    await app.user.type(screen.getByLabelText('Efectivo recibido'), '1000');
    expect(confirm).toBeDisabled();
    await app.user.clear(screen.getByLabelText('Efectivo recibido'));
    await app.user.type(screen.getByLabelText('Efectivo recibido'), '1300');
    expect(screen.getByText(/Pagado/)).toHaveTextContent('Pagado $1,300.00 · Cambio $52.00');
    expect(confirm).toBeEnabled();

    await verifyAll(app);
    await app.user.click(confirm);
    await waitFor(() => expect(callsTo(fetchMock, checkoutKey)).toHaveLength(1));
    expect(bodyOf(fetchMock)).toEqual({
      cashSessionId: SESSION_C1,
      payments: [{ method: 'CASH', amount: 124800, received: 130000 }],
      customerName: 'María',
      verifiedUnits: 2,
    });
  });

  it('combina efectivo y tarjeta con referencia', async () => {
    const fetchMock = start();
    const app = renderApp(url);
    await app.user.click(await screen.findByRole('button', { name: 'Tarjeta' }));
    // Un solo método: se propone el total.
    expect(screen.getByLabelText('Tarjeta')).toHaveValue('1248.00');
    await app.user.clear(screen.getByLabelText('Tarjeta'));
    await app.user.type(screen.getByLabelText('Tarjeta'), '300');
    await app.user.type(screen.getByLabelText('Referencia (Tarjeta)'), 'AUT-123');
    expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
    await app.user.click(screen.getByRole('button', { name: 'Efectivo' }));
    await app.user.click(screen.getByRole('button', { name: '$1,000.00' }));
    expect(screen.getByText(/Pagado/)).toHaveTextContent('Pagado $1,300.00 · Cambio $52.00');

    await verifyAll(app);
    await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await waitFor(() => expect(callsTo(fetchMock, checkoutKey)).toHaveLength(1));
    expect(bodyOf(fetchMock).payments).toEqual([
      { method: 'CASH', amount: 94800, received: 100000 },
      { method: 'CARD', amount: 30000, reference: 'AUT-123' },
    ]);
  });

  it('un 400 PAYMENT_TOTAL_MISMATCH muestra el mensaje sin salir', async () => {
    start({
      [checkoutKey]: () =>
        apiError(400, 'PAYMENT_TOTAL_MISMATCH', 'Los pagos no cuadran con el total.', {
          total: 124900,
          paid: 124800,
        }),
    });
    const app = renderApp(url);
    await app.user.click(await screen.findByRole('button', { name: 'Transferencia' }));
    await verifyAll(app);
    await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    expect(await screen.findByText('Los pagos no cuadran con el total.')).toBeInTheDocument();
    expect(app.location()).toBe(url);
  });
});

describe('CheckoutPage: impresión del ticket (T32)', () => {
  const printRoot = () => document.getElementById(PRINT_ROOT_ID)!;

  async function payByCard(app: ReturnType<typeof renderApp>) {
    await app.user.click(await screen.findByRole('button', { name: 'Tarjeta' }));
    await verifyAll(app);
    await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    expect(await screen.findByText('Venta S1-000001 cobrada')).toBeInTheDocument();
  }

  it('por defecto imprime automático en ticket-80', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    start();
    const app = renderApp(url);
    await payByCard(app);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printRoot().querySelector('[data-print-size="ticket-80"]')).not.toBeNull();
    expect(within(printRoot()).getByText('Folio S1-000001')).toBeInTheDocument();
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(printRoot().querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });

  it('con la impresión automática apagada en "Ajustes del ticket" muestra la vista previa', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    start();
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: 'Menú' }));
    await app.user.click(await screen.findByRole('button', { name: 'Ajustes del ticket' }));
    const settings = await screen.findByRole('dialog', { name: 'Ajustes del ticket' });
    await app.user.click(within(settings).getByLabelText('Imprimir el ticket al cobrar'));
    await app.user.click(within(settings).getByRole('button', { name: '58 mm' }));
    expect(localStorage.getItem(AUTO_PRINT_KEY)).toBe('false');
    expect(localStorage.getItem(TICKET_WIDTH_KEY)).toBe('58');
    await app.user.keyboard('{Escape}');

    await app.router.navigate(url);
    await payByCard(app);
    expect(print).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('ticket-preview')).getByText('Folio S1-000001'),
    ).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Imprimir' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printRoot().querySelector('[data-print-size="ticket-58"]')).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('si localStorage falla al leer los ajustes, imprime automático a 80 mm', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    const original = Storage.prototype.getItem;
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === AUTO_PRINT_KEY || key === TICKET_WIDTH_KEY) throw new Error('bloqueado');
      return original.call(this, key);
    });
    start();
    const app = renderApp(url);
    await payByCard(app);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printRoot().querySelector('[data-print-size="ticket-80"]')).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    getItem.mockRestore();
    print.mockRestore();
  });

  it('el carrito ya cobrado no se puede volver a cobrar', async () => {
    start({ [cartKey(cart.id)]: ok({ ...cart, status: 'CHECKED_OUT' }) });
    renderApp(url);
    expect(await screen.findByText('El carrito ya se cobró o se descartó.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument();
  });
});
