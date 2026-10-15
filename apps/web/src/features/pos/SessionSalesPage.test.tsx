import { screen, waitFor, within } from '@testing-library/react';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { NO_DEVICE_REGISTER_MESSAGE } from './SessionSalesPage';
import {
  cancelKey,
  JUAN,
  makeSaleListItem,
  makeSessionDto,
  makeTicket,
  ok,
  posRoutes,
  saveDeviceRegister,
  sessionKey,
  sessionSalesKey,
  ticketKey,
} from './testing';

const first = makeSaleListItem({ folio: 'S1-000001', createdAt: '2026-10-15T16:15:00.000Z' });
const second = makeSaleListItem({
  folio: 'S1-000002',
  createdAt: '2026-10-15T17:40:00.000Z',
  total: 34900,
  seller: JUAN,
  methods: ['CASH', 'CARD'],
});
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 50, total: items.length });
const ticket = makeTicket();

function start(routes: object = {}, options: Parameters<typeof posRoutes>[1] = {}) {
  saveDeviceRegister();
  return mockFetch(
    posRoutes(
      {
        [sessionKey()]: ok(makeSessionDto()),
        [sessionSalesKey()]: ok(page([second, first])),
        [ticketKey(first.id)]: ok(ticket),
        ...routes,
      },
      options,
    ),
  );
}

const saleRow = (folio: string) => screen.findByRole('listitem', { name: `Venta ${folio}` });

describe('SessionSalesPage (T33)', () => {
  it('lista las ventas de la caja del dispositivo con folio, hora, total, vendedor, métodos y estado', async () => {
    start();
    renderApp('/pos/sales');
    expect(
      await screen.findByRole('heading', { name: 'Mi caja · Historial · Caja 1' }),
    ).toBeInTheDocument();
    const rows = within(await screen.findByRole('list', { name: 'Ventas' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent(
      'S1-00000211:40$349.00Vendió Juan Pérez · Efectivo + TarjetaCobrada',
    );
    expect(rows[1]).toHaveTextContent('S1-00000110:15$1,248.00Vendió Ana López · EfectivoCobrada');
  });

  it('"Reimprimir" pide el ticket e imprime', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    const fetchMock = start();
    const app = renderApp('/pos/sales');
    await app.user.click(
      within(await saleRow('S1-000001')).getByRole('button', { name: 'Reimprimir' }),
    );
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(callsTo(fetchMock, ticketKey(first.id))).toHaveLength(1);
    const root = document.getElementById(PRINT_ROOT_ID)!;
    expect(root.querySelector('[data-print-size="ticket-80"]')).not.toBeNull();
    expect(within(root).getByText('Folio S1-000001')).toBeInTheDocument();
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('"Cancelar venta" solo con pos.sale.cancel', async () => {
    start();
    renderApp('/pos/sales');
    const row = await saleRow('S1-000001');
    expect(within(row).getByRole('button', { name: 'Reimprimir' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Cancelar venta' })).not.toBeInTheDocument();
  });

  it('cancelar exige el motivo, envía SaleCancelInput y la venta muestra su estado', async () => {
    const cancelled = makeSaleListItem({ ...first, status: 'CANCELLED' });
    const fetchMock = start(
      {
        [sessionSalesKey()]: [ok(page([second, first])), ok(page([second, cancelled]))],
        [cancelKey(first.id)]: ok({
          ...ticket,
          sale: { ...ticket.sale, status: 'CANCELLED', folio: 'S1-000001' },
        }),
      },
      { role: 'MANAGER' },
    );
    const app = renderApp('/pos/sales');
    await app.user.click(
      within(await saleRow('S1-000001')).getByRole('button', { name: 'Cancelar venta' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar venta S1-000001' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancelar venta' });
    expect(confirm).toBeDisabled();
    await app.user.type(within(dialog).getByLabelText('Motivo'), 'ab');
    expect(within(dialog).getByText('Escribe el motivo (mínimo 3 caracteres)')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await app.user.type(within(dialog).getByLabelText('Motivo'), 'c error');
    await app.user.click(confirm);

    await waitFor(() => expect(callsTo(fetchMock, cancelKey(first.id))).toHaveLength(1));
    const [, init] = callsTo(fetchMock, cancelKey(first.id))[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: 'abc error' });
    expect(await screen.findByText('Venta S1-000001 cancelada')).toBeInTheDocument();
    const row = await saleRow('S1-000001');
    await waitFor(() => expect(row).toHaveTextContent('Cancelada'));
    expect(within(row).queryByRole('button', { name: 'Cancelar venta' })).not.toBeInTheDocument();
  });

  it('sin caja en el dispositivo lo dice y ofrece elegir una', async () => {
    mockFetch(posRoutes({}));
    renderApp('/pos/sales');
    expect(await screen.findByText(NO_DEVICE_REGISTER_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Elegir caja' })).toHaveAttribute(
      'href',
      '/pos/register?next=%2Fpos%2Fsales',
    );
  });
});
