import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  cartActionKey,
  cartKey,
  cartsKey,
  CREATE_CART_KEY,
  created,
  makeCart,
  makeItem,
  ok,
  posRoutes,
  summaryOf,
} from './testing';

const active = makeCart([makeItem()], { number: 12, label: 'Señora rojo' });
const suspended = makeCart([makeItem()], { number: 15, status: 'SUSPENDED', customerName: 'Juan' });

function start(carts = [active, suspended], routes: object = {}) {
  return mockFetch(
    posRoutes({
      [cartsKey('mine')]: ok(carts.map(summaryOf)),
      [cartKey(active.id)]: ok(active),
      ...routes,
    }),
  );
}

/** La barra ya con los carritos cargados (antes solo trae [+]). */
const bar = async () => {
  await screen.findByRole('button', { name: '#12 Señora rojo' });
  return screen.getByRole('group', { name: 'Mis carritos' });
};

describe('CartBar (T28)', () => {
  it('chips del activo y los suspendidos con su número; el activo en grande', async () => {
    start();
    renderApp('/pos/sell');
    const chips = within(await bar()).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['#12 Señora rojo', '#15 Juan', '']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Carrito #12')).toBeInTheDocument();
  });

  it('tocar uno suspendido lo retoma; "Nuevo carrito" llama a POST /carts', async () => {
    const fetchMock = start([active, suspended], {
      [cartActionKey(suspended.id, 'resume')]: ok({ ...suspended, status: 'ACTIVE' }),
      [CREATE_CART_KEY]: created(makeCart([], { number: 3 })),
    });
    const app = renderApp('/pos/sell');
    await app.user.click(within(await bar()).getByRole('button', { name: '#15 Juan' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, cartActionKey(suspended.id, 'resume'))).toHaveLength(1),
    );
    await app.user.click(screen.getByRole('button', { name: 'Nuevo carrito' }));
    await waitFor(() => expect(callsTo(fetchMock, CREATE_CART_KEY)).toHaveLength(1));
  });

  it('"Suspender" pide etiqueta y cliente', async () => {
    const fetchMock = start([active], {
      [cartActionKey(active.id, 'suspend')]: ok({ ...active, status: 'SUSPENDED' }),
    });
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: 'Suspender' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspender carrito #12' });
    const label = within(dialog).getByLabelText('Etiqueta');
    expect(label).toHaveValue('Señora rojo');
    await app.user.clear(label);
    await app.user.type(label, 'Señora vestido rojo');
    await app.user.type(within(dialog).getByLabelText('Cliente'), 'María');
    await app.user.click(within(dialog).getByRole('button', { name: 'Suspender' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, cartActionKey(active.id, 'suspend'))).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, cartActionKey(active.id, 'suspend'))[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      label: 'Señora vestido rojo',
      customerName: 'María',
    });
    expect(await screen.findByText('Carrito #12 suspendido')).toBeInTheDocument();
  });

  it('con 5 suspendidos, "Suspender" se deshabilita con el aviso', async () => {
    const five = [1, 2, 3, 4, 5].map((n) =>
      makeCart([makeItem()], { number: n, status: 'SUSPENDED' }),
    );
    start([active, ...five]);
    renderApp('/pos/sell');
    expect(await screen.findByRole('button', { name: 'Suspender' })).toBeDisabled();
    expect(screen.getByText('Ya tienes 5 carritos suspendidos')).toBeInTheDocument();
    // Crear otro también suspendería el activo con partidas: se deshabilita igual.
    expect(screen.getByRole('button', { name: 'Nuevo carrito' })).toBeDisabled();
  });
});
