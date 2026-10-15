import { screen, waitFor, within } from '@testing-library/react';
import { BRANCH_S1 } from '@/test/fixtures';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { registerStorageKey } from './device';
import {
  C1,
  C2,
  cartActionKey,
  cartKey,
  created,
  makeCart,
  makeItem,
  makeSessionDto,
  ok,
  OPEN_SESSION_KEY,
  posRoutes,
  REGISTERS_KEY,
  saveDeviceRegister,
  SESSION_C1,
  sessionKey,
} from './testing';

const stored = () => JSON.parse(localStorage.getItem(registerStorageKey(BRANCH_S1.id)) ?? 'null');
const rowOf = async (code: string) => {
  const list = await screen.findByRole('list', { name: 'Cajas' });
  return within(list)
    .getByText(new RegExp(`^${code} ·`))
    .closest('li')!;
};

describe('PosRegisterPage (T24)', () => {
  it('lista las cajas; "Cobrar en esta caja" guarda la caja y vuelve a next', async () => {
    mockFetch(posRoutes({}));
    const app = renderApp('/pos/register?next=%2Fpos%2Fcarts');
    const c1 = await rowOf('C1');
    expect(c1).toHaveTextContent('Abierta por Luis 09:02');
    expect(await rowOf('C2')).toHaveTextContent('Cerrada');

    await app.user.click(within(c1).getByRole('button', { name: 'Cobrar en esta caja' }));
    expect(stored()).toEqual({ registerId: C1, sessionId: SESSION_C1 });
    await waitFor(() => expect(app.location()).toBe('/pos/carts'));
  });

  it('"Abrir" solo con pos.session.open y envía el fondo en centavos', async () => {
    const opened = makeSessionDto({
      id: 'eeeeeeee-0000-4000-8000-0000000000c2',
      cashRegisterId: C2,
    });
    const fetchMock = mockFetch(posRoutes({ [OPEN_SESSION_KEY]: created(opened) }));
    const app = renderApp('/pos/register');
    const c2 = await rowOf('C2');
    await app.user.click(within(c2).getByRole('button', { name: 'Abrir' }));
    await app.user.type(await screen.findByLabelText('Fondo inicial'), '500');
    await app.user.click(screen.getByRole('button', { name: 'Abrir caja' }));

    await waitFor(() => expect(callsTo(fetchMock, OPEN_SESSION_KEY)).toHaveLength(1));
    const [, init] = callsTo(fetchMock, OPEN_SESSION_KEY)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      cashRegisterId: C2,
      openingAmount: 50000,
    });
    await waitFor(() => expect(app.location()).toBe('/pos'));
    expect(stored()).toEqual({ registerId: C2, sessionId: opened.id });
  });

  it('sin pos.session.open no hay "Abrir"', async () => {
    mockFetch(posRoutes({}, { remove: ['pos.session.open'] }));
    renderApp('/pos/register');
    const c2 = await rowOf('C2');
    expect(within(c2).queryByRole('button', { name: 'Abrir' })).not.toBeInTheDocument();
  });

  it('un 409 CASH_SESSION_ALREADY_OPEN refresca la lista', async () => {
    const fetchMock = mockFetch(
      posRoutes({
        [OPEN_SESSION_KEY]: () =>
          apiError(409, 'CASH_SESSION_ALREADY_OPEN', 'Esta caja ya está abierta.'),
      }),
    );
    const app = renderApp('/pos/register');
    await app.user.click(within(await rowOf('C2')).getByRole('button', { name: 'Abrir' }));
    await app.user.type(await screen.findByLabelText('Fondo inicial'), '0');
    await app.user.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(await screen.findByText('Esta caja ya está abierta.')).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, REGISTERS_KEY)).toHaveLength(2));
  });

  describe('ir a cobrar', () => {
    const cart = makeCart([makeItem()]);
    const checkoutUrl = `/pos/checkout/${cart.id}`;
    const registerUrl = `/pos/register?next=${encodeURIComponent(checkoutUrl)}`;

    it('sin caja guardada lleva a elegir caja', async () => {
      mockFetch(posRoutes({ [cartKey(cart.id)]: ok(cart) }));
      const app = renderApp(checkoutUrl);
      await waitFor(() => expect(app.location()).toBe(registerUrl));
      expect(
        await screen.findByRole('heading', { name: '¿Desde qué caja cobras?' }),
      ).toBeInTheDocument();
    });

    it('con la sesión guardada cerrada lleva a elegir caja', async () => {
      saveDeviceRegister();
      mockFetch(
        posRoutes({
          [sessionKey()]: ok(makeSessionDto({ status: 'CLOSED' })),
          [cartKey(cart.id)]: ok(cart),
        }),
      );
      const app = renderApp(checkoutUrl);
      await waitFor(() => expect(app.location()).toBe(registerUrl));
    });

    it('un 409 CASH_SESSION_CLOSED al cobrar avisa "La caja se cerró" y lleva a elegir otra', async () => {
      saveDeviceRegister();
      const fetchMock = mockFetch(
        posRoutes({
          [sessionKey()]: ok(makeSessionDto()),
          [cartKey(cart.id)]: ok(cart),
          [cartActionKey(cart.id, 'checkout')]: () =>
            apiError(409, 'CASH_SESSION_CLOSED', 'La caja ya está cerrada.'),
        }),
      );
      const app = renderApp(checkoutUrl);
      await app.user.click(await screen.findByRole('button', { name: 'Tarjeta' }));
      await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
      await app.user.click(await screen.findByRole('button', { name: 'Cobrar' }));

      expect(await screen.findByText('La caja se cerró')).toBeInTheDocument();
      await waitFor(() => expect(app.location()).toBe(registerUrl));
      expect(stored()).toBeNull();
      // El carrito no se pierde: no se descartó ni se tocó.
      expect(callsTo(fetchMock, cartActionKey(cart.id, 'discard'))).toHaveLength(0);
    });
  });
});
