import { act, screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { BRANCH_CARTS_REFRESH_MS } from './api';
import { CART_NUMBER_NOT_FOUND } from './BranchCartsPage';
import {
  ANA,
  BELT,
  cartActionKey,
  cartKey,
  cartsKey,
  JUAN,
  makeCart,
  makeItem,
  ok,
  posRoutes,
  summaryOf,
} from './testing';

const anaCart = makeCart([makeItem({ quantity: 2 })], {
  number: 12,
  owner: ANA,
  userId: ANA.id,
  label: 'Señora rojo',
  status: 'SUSPENDED',
});
const juanCart = makeCart([BELT()], { number: 15, owner: JUAN, userId: JUAN.id });

function start(routes: object = {}) {
  return mockFetch(
    posRoutes({
      [cartsKey('all')]: ok([summaryOf(anaCart), summaryOf(juanCart)]),
      [cartsKey('all', 12)]: ok([summaryOf(anaCart)]),
      [cartsKey('all', 99)]: ok([]),
      [cartKey(anaCart.id)]: ok(anaCart),
      ...routes,
    }),
  );
}

describe('BranchCartsPage (T29)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pide scope=all, lista los carritos y se refresca cada 15 s', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const fetchMock = start();
    renderApp('/pos/carts');
    const list = await screen.findByRole('list', { name: 'Carritos' });
    const cards = within(list).getAllByRole('button');
    expect(cards[0]).toHaveAccessibleName('Carrito #12');
    expect(cards[0]).toHaveTextContent('#12Ana LópezSeñora rojo2 pzas · suspendido$1,798.00');
    expect(cards[1]).toHaveTextContent('#15Juan Pérez1 pza$349.00');
    expect(callsTo(fetchMock, cartsKey('all'))).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(BRANCH_CARTS_REFRESH_MS);
    });
    await waitFor(() => expect(callsTo(fetchMock, cartsKey('all'))).toHaveLength(2));
  });

  it('"Buscar #" con 12 pide number=12 y abre ese carrito; sin resultado avisa', async () => {
    const fetchMock = start();
    const app = renderApp('/pos/carts');
    const search = await screen.findByLabelText('Buscar #');
    await app.user.type(search, '12{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Carrito #12 · Ana López' });
    expect(callsTo(fetchMock, cartsKey('all', 12))).toHaveLength(1);
    expect(within(dialog).getByRole('link', { name: 'Cobrar' })).toHaveAttribute(
      'href',
      `/pos/checkout/${anaCart.id}`,
    );
    await app.user.keyboard('{Escape}');

    await app.user.type(search, '99{Enter}');
    expect(await screen.findByText(CART_NUMBER_NOT_FOUND)).toBeInTheDocument();
  });

  it('tocar un carrito abre su detalle; "Descartar" libera las piezas', async () => {
    const fetchMock = start({
      [cartActionKey(anaCart.id, 'discard')]: ok({ ...anaCart, status: 'DISCARDED' }),
    });
    const app = renderApp('/pos/carts');
    await app.user.click(await screen.findByRole('button', { name: 'Carrito #12' }));
    const dialog = await screen.findByRole('dialog', { name: 'Carrito #12 · Ana López' });
    expect(await within(dialog).findByRole('list', { name: 'Partidas' })).toHaveTextContent(
      '2 × Zapato de piel dama 25 · Negro A-01-01',
    );
    await app.user.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    const confirm = await screen.findByRole('dialog', { name: 'Descartar carrito #12' });
    await app.user.click(within(confirm).getByRole('button', { name: 'Enviar todo a staging' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, cartActionKey(anaCart.id, 'discard'))).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, cartActionKey(anaCart.id, 'discard'))[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ releaseTo: 'STAGING' });
    expect(await screen.findByText('Carrito #12 descartado')).toBeInTheDocument();
  });
});
