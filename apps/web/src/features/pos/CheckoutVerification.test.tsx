import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  ALREADY_VERIFIED_MESSAGE,
  NOT_IN_CART_MESSAGE,
  SCAN_VARIANT_MESSAGE,
} from './CheckoutVerification';
import {
  BELT,
  cartActionKey,
  cartKey,
  created,
  makeCart,
  makeItem,
  makeSessionDto,
  makeTicket,
  ok,
  posRoutes,
  saveDeviceRegister,
  sessionKey,
} from './testing';

const shoe = makeItem({ quantity: 2 });
const belt = BELT();
const cart = makeCart([shoe, belt]);
const checkoutKey = cartActionKey(cart.id, 'checkout');

function start() {
  saveDeviceRegister();
  return mockFetch(
    posRoutes({
      [sessionKey()]: ok(makeSessionDto()),
      [cartKey(cart.id)]: ok(cart),
      [checkoutKey]: created(makeTicket()),
    }),
  );
}

async function open() {
  const app = renderApp(`/pos/checkout/${cart.id}`);
  const field = await screen.findByLabelText('Verificar piezas (opcional)');
  const scan = (code: string) => app.user.type(field, `${code}{Enter}`);
  const piece = (name: string) =>
    within(screen.getByRole('list', { name: 'Piezas del carrito' })).getByRole('listitem', {
      name: new RegExp(`^${name}:`),
    });
  return { app, scan, piece };
}

const pay = async (app: ReturnType<typeof renderApp>) => {
  await app.user.click(screen.getByRole('button', { name: 'Tarjeta' }));
  await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
};

describe('verificación en caja (T36)', () => {
  it('cada lectura del SKU o del código de barras suma 1 y palomea al completar', async () => {
    start();
    const { scan, piece } = await open();
    expect(screen.getByText('0 de 3 piezas verificadas')).toBeInTheDocument();

    await scan('ZAP0101-25-NEG');
    expect(await screen.findByText('1 de 3 piezas verificadas')).toBeInTheDocument();
    expect(piece('Zapato de piel dama 25 · Negro')).toHaveAccessibleName(
      'Zapato de piel dama 25 · Negro: 1 de 2',
    );

    await scan('7501234567890');
    expect(await screen.findByText('2 de 3 piezas verificadas')).toBeInTheDocument();
    expect(piece('Zapato de piel dama 25 · Negro')).toHaveAccessibleName(
      'Zapato de piel dama 25 · Negro: 2 de 2, verificada',
    );
  });

  it('una pieza de más, una ajena o un SKU padre solo avisan', async () => {
    start();
    const { scan, piece } = await open();
    await scan('CIN0001');
    await screen.findByText('1 de 3 piezas verificadas');

    await scan('CIN0001');
    expect(await screen.findByText(ALREADY_VERIFIED_MESSAGE)).toBeInTheDocument();
    await scan('BOL0001');
    expect(await screen.findByText(NOT_IN_CART_MESSAGE)).toBeInTheDocument();
    await scan('ZAP0101');
    expect(await screen.findByText(SCAN_VARIANT_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('1 de 3 piezas verificadas')).toBeInTheDocument();
    expect(piece('Cinturón')).toHaveAccessibleName('Cinturón: 1 de 1, verificada');
  });

  it('con piezas sin verificar pide confirmar y solo cobra al aceptar', async () => {
    const fetchMock = start();
    const { app, scan } = await open();
    await scan('CIN0001');
    await pay(app);

    const dialog = await screen.findByRole('dialog', {
      name: 'Faltan 2 piezas por verificar. ¿Cobrar de todos modos?',
    });
    await app.user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(callsTo(fetchMock, checkoutKey)).toHaveLength(0);

    await app.user.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await app.user.click(await screen.findByRole('button', { name: 'Cobrar' }));
    await waitFor(() => expect(callsTo(fetchMock, checkoutKey)).toHaveLength(1));
    const [, init] = callsTo(fetchMock, checkoutKey)[0]!;
    expect(JSON.parse((init as RequestInit).body as string).verifiedUnits).toBe(1);
  });

  it('con todo verificado cobra directo', async () => {
    const fetchMock = start();
    const { app, scan } = await open();
    await scan('ZAP0101-25-NEG');
    await scan('ZAP0101-25-NEG');
    await scan('CIN0001');
    await screen.findByText('3 de 3 piezas verificadas');
    await pay(app);
    await waitFor(() => expect(callsTo(fetchMock, checkoutKey)).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: /Faltan/ })).not.toBeInTheDocument();
  });
});
