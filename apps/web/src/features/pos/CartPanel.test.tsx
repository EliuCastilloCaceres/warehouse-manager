import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  BELT,
  cartKey,
  cartsKey,
  itemKey,
  makeCart,
  makeItem,
  ok,
  posRoutes,
  RACK_STG,
  removeItemKey,
  summaryOf,
} from './testing';

const shoe = makeItem({ quantity: 2 });
const belt = BELT();
const stagingShoe = makeItem({
  sku: 'ZAP0101-26-NEG',
  variantLabel: '26 · Negro',
  sourceRackId: RACK_STG,
  locationCode: 'STG-01-01',
  isStaging: true,
});
const cart = makeCart([shoe, belt, stagingShoe]);
const SHOE = 'Zapato de piel dama 25 · Negro';

function start(options: Parameters<typeof posRoutes>[1] = {}) {
  return mockFetch(
    posRoutes(
      {
        [cartsKey('mine')]: ok([summaryOf(cart)]),
        [cartKey(cart.id)]: ok(cart),
        [itemKey(cart.id, shoe.id)]: ok(cart),
        [itemKey(cart.id, belt.id)]: ok(cart),
        [removeItemKey(cart.id, belt.id, 'RACK')]: ok(cart),
        [removeItemKey(cart.id, stagingShoe.id, 'RACK')]: ok(cart),
      },
      options,
    ),
  );
}

const bodyOf = (fetchMock: jest.Mock, key: string) =>
  JSON.parse((callsTo(fetchMock, key)[0]![1] as RequestInit).body as string);

describe('CartPanel (T27)', () => {
  it('muestra las partidas con su ubicación y el total fijo', async () => {
    start();
    renderApp('/pos/sell');
    const items = await screen.findByRole('list', { name: 'Partidas' });
    const rows = within(items).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(SHOE);
    expect(rows[0]).toHaveTextContent('A-01-01');
    expect(rows[0]).toHaveTextContent('$1,798.00');
    expect(rows[2]).toHaveTextContent('STG-01-01');
    expect(screen.getByRole('heading', { name: 'Carrito (4 pzas)' })).toBeInTheDocument();
    // 2 × 899.00 + 349.00 + 899.00
    expect(screen.getByText('Total').closest('p')).toHaveTextContent('$3,046.00');
    expect(screen.getByRole('link', { name: 'Cobrar' })).toHaveAttribute(
      'href',
      `/pos/checkout/${cart.id}`,
    );
  });

  it('[+] envía la cantidad nueva', async () => {
    const fetchMock = start();
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: `Más (${SHOE})` }));
    await waitFor(() => expect(callsTo(fetchMock, itemKey(cart.id, shoe.id))).toHaveLength(1));
    expect(bodyOf(fetchMock, itemKey(cart.id, shoe.id))).toEqual({ quantity: 3 });
  });

  it('[−] abre la hoja y envía releaseTo', async () => {
    const fetchMock = start();
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: `Menos (${SHOE})` }));
    const sheet = await screen.findByRole('dialog', { name: '¿Qué hacemos con el producto?' });
    expect(
      within(sheet).getByRole('button', { name: 'Regresar a su ubicación (A-01-01)' }),
    ).toBeInTheDocument();
    await app.user.click(within(sheet).getByRole('button', { name: 'Enviar a staging' }));
    await waitFor(() => expect(callsTo(fetchMock, itemKey(cart.id, shoe.id))).toHaveLength(1));
    expect(bodyOf(fetchMock, itemKey(cart.id, shoe.id))).toEqual({
      quantity: 1,
      releaseTo: 'STAGING',
    });
  });

  it('"Quitar" abre la misma hoja; una partida de staging solo regresa a staging', async () => {
    const fetchMock = start();
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de Cinturón' }));
    await app.user.click(await screen.findByRole('button', { name: 'Quitar' }));
    const sheet = await screen.findByRole('dialog', { name: '¿Qué hacemos con el producto?' });
    await app.user.click(
      within(sheet).getByRole('button', { name: 'Regresar a su ubicación (C-01-01)' }),
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, removeItemKey(cart.id, belt.id, 'RACK'))).toHaveLength(1),
    );

    // Con una sola pieza, [−] también quita.
    await app.user.click(
      screen.getByRole('button', { name: 'Menos (Zapato de piel dama 26 · Negro)' }),
    );
    const staging = await screen.findByRole('dialog', { name: '¿Qué hacemos con el producto?' });
    expect(
      within(staging).queryByRole('button', { name: 'Enviar a staging' }),
    ).not.toBeInTheDocument();
    await app.user.click(
      within(staging).getByRole('button', { name: 'Regresar a staging (STG-01-01)' }),
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, removeItemKey(cart.id, stagingShoe.id, 'RACK'))).toHaveLength(1),
    );
  });

  it('sin pos.discount no hay "Descuento"', async () => {
    start();
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de Cinturón' }));
    expect(await screen.findByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descuento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descuento al total' })).not.toBeInTheDocument();
  });

  it('con pos.discount, 10 % sobre $899.00 envía discount: 8990', async () => {
    const one = makeCart([makeItem({ id: shoe.id })], { id: cart.id });
    const fetchMock = mockFetch(
      posRoutes(
        {
          [cartsKey('mine')]: ok([summaryOf(one)]),
          [cartKey(cart.id)]: ok(one),
          [itemKey(cart.id, shoe.id)]: ok(one),
        },
        { role: 'MANAGER' },
      ),
    );
    const app = renderApp('/pos/sell');
    await app.user.click(await screen.findByRole('button', { name: `Opciones de ${SHOE}` }));
    await app.user.click(await screen.findByRole('button', { name: 'Descuento' }));
    const dialog = await screen.findByRole('dialog', { name: `Descuento · ${SHOE}` });
    await app.user.click(within(dialog).getByRole('button', { name: '%' }));
    await app.user.type(within(dialog).getByLabelText('Descuento (%)'), '10');
    expect(dialog).toHaveTextContent('Descuento $89.90 · Total nuevo $809.10');
    await app.user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(callsTo(fetchMock, itemKey(cart.id, shoe.id))).toHaveLength(1));
    expect(bodyOf(fetchMock, itemKey(cart.id, shoe.id))).toEqual({ discount: 8990 });
  });
});
