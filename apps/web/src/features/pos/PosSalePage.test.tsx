import type { LocateVariantDto } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { makeLocate, makeLocateVariant } from '@/features/warehouse/testing';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { VARIANT_INACTIVE_MESSAGE } from './ProductPicker';
import {
  cartActionKey,
  cartKey,
  cartsKey,
  CREATE_CART_KEY,
  created,
  lookupKey,
  makeCart,
  makeItem,
  makeRegister,
  ok,
  posRoutes,
  REGISTERS_KEY,
  summaryOf,
} from './testing';

const S2 = {
  branchId: '22222222-2222-4222-8222-222222222222',
  code: 'S2',
  name: 'Sucursal 2',
  phone: '55 1234 5678',
  available: 2,
};

/** Variante con color propio (las de `makeLocateVariant` son negras). */
function variant(sku: string, color: string, overrides: Partial<LocateVariantDto> = {}) {
  const item = makeLocateVariant(sku, overrides);
  return { ...item, variant: { ...item.variant, color } };
}

const neg25 = variant('ZAP0101-25-NEG', 'Negro', { otherBranches: [S2] });
const neg26 = variant('ZAP0101-26-NEG', 'Negro', {
  totals: { quantity: 0, reservedQty: 0, available: 0 },
  locations: [],
  otherBranches: [S2],
});
const caf25 = variant('ZAP0101-25-CAF', 'Café', { otherBranches: null });
const parent = makeLocate([neg25, neg26, caf25]);
const rackA1 = neg25.locations[0]!.rackId;

const cart = makeCart([makeItem()]);

function start(routes: object = {}, options: Parameters<typeof posRoutes>[1] = {}) {
  return mockFetch(
    posRoutes(
      {
        [cartsKey('mine')]: ok([summaryOf(cart)]),
        [cartKey(cart.id)]: ok(cart),
        [lookupKey('ZAP0101')]: ok(parent),
        [lookupKey('ZAP0101-25-NEG')]: ok(makeLocate([neg25])),
        [lookupKey('ZAP0101-26-NEG')]: ok(makeLocate([neg26])),
        ...routes,
      },
      options,
    ),
  );
}

const scan = async (app: ReturnType<typeof renderApp>, code: string) => {
  await app.user.type(await screen.findByLabelText('Buscar producto'), `${code}{Enter}`);
};

describe('PosSalePage: Atender (T25)', () => {
  it('no pide caja; un escaneo llama a lookup y el selector marca lo que no hay aquí', async () => {
    const fetchMock = start();
    const app = renderApp('/pos/sell');
    expect(await screen.findByRole('heading', { name: 'Atender · Eliu' })).toBeInTheDocument();
    expect(app.location()).toBe('/pos/sell');

    await scan(app, 'zap0101');
    const sizes = await screen.findByRole('group', { name: 'Talla' });
    expect(callsTo(fetchMock, lookupKey('ZAP0101'))).toHaveLength(1);
    expect(within(sizes).getByRole('button', { name: '25' })).toBeInTheDocument();
    expect(
      within(sizes).getByRole('button', { name: '26 (sin disponibles aquí)' }),
    ).toBeInTheDocument();
    const colors = screen.getByRole('group', { name: 'Color' });
    expect(
      within(colors)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Negro', 'Café']);

    // SKU padre: hay que elegir antes de ver ubicaciones.
    expect(screen.getByText('Elige la variante para ver sus ubicaciones.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Ubicaciones' })).not.toBeInTheDocument();

    await app.user.click(within(sizes).getByRole('button', { name: '25' }));
    await app.user.click(within(colors).getByRole('button', { name: 'Negro' }));
    const locations = await screen.findByRole('list', { name: 'Ubicaciones' });
    expect(
      within(locations)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['A-01-013Agregar', 'STG-01-012Agregar']);
    // Con talla 26 elegida, el color negro ya no tiene disponibles.
    await app.user.click(within(sizes).getByRole('button', { name: '25' }));
    await app.user.click(within(sizes).getByRole('button', { name: '26 (sin disponibles aquí)' }));
    expect(
      within(colors).getByRole('button', { name: 'Negro (sin disponibles aquí)' }),
    ).toBeInTheDocument();
  });

  it('"Agregar" desde A-01-01 envía CartItemAddInput al carrito activo', async () => {
    const fetchMock = start({ [cartActionKey(cart.id, 'items')]: created(cart) });
    const app = renderApp('/pos/sell');
    await scan(app, 'ZAP0101-25-NEG');
    await app.user.click(await screen.findByRole('button', { name: 'Agregar desde A-01-01' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, cartActionKey(cart.id, 'items'))).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, cartActionKey(cart.id, 'items'))[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      variantId: neg25.variant.id,
      sourceRackId: rackA1,
      quantity: 1,
    });
    expect(callsTo(fetchMock, CREATE_CART_KEY)).toHaveLength(0);
  });

  it('sin carrito activo, el primer "Agregar" crea el carrito y luego muestra su número', async () => {
    const fresh = makeCart([], { number: 7 });
    const withItem = makeCart([makeItem()], { id: fresh.id, number: 7 });
    const fetchMock = start({
      [cartsKey('mine')]: [ok([]), ok([summaryOf(withItem)])],
      [CREATE_CART_KEY]: created(fresh),
      [cartActionKey(fresh.id, 'items')]: created(withItem),
      [cartKey(fresh.id)]: ok(withItem),
    });
    const app = renderApp('/pos/sell');
    await scan(app, 'ZAP0101-25-NEG');
    expect(screen.queryByText(/Carrito #/)).not.toBeInTheDocument();
    await app.user.click(await screen.findByRole('button', { name: 'Agregar desde A-01-01' }));

    expect(await screen.findByText('Carrito #7')).toBeInTheDocument();
    const order = fetchMock.mock.calls
      .map(([url, init]) => `${(init as RequestInit).method ?? 'GET'} ${String(url)}`)
      .filter((key) => key.startsWith('POST /api/v1/pos/carts'));
    expect(order).toEqual([CREATE_CART_KEY, cartActionKey(fresh.id, 'items')]);
  });

  it('una variante desactivada no se puede agregar', async () => {
    const inactive = makeLocateVariant('ZAP0101-25-NEG');
    inactive.variant = { ...inactive.variant, isEffectivelyActive: false };
    start({ [lookupKey('ZAP0101-25-NEG')]: ok(makeLocate([inactive])) });
    const app = renderApp('/pos/sell');
    await scan(app, 'ZAP0101-25-NEG');
    expect(await screen.findByText(VARIANT_INACTIVE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar desde A-01-01' })).toBeDisabled();
  });

  it('sin cajas abiertas en la sucursal avisa y deshabilita "Agregar"', async () => {
    start({ [REGISTERS_KEY]: ok([makeRegister('C1'), makeRegister('C2')]) });
    const app = renderApp('/pos/sell');
    const alert = await screen.findByText('No hay cajas abiertas');
    expect(
      within(alert.closest('[role="alert"]')!).getByRole('link', { name: 'Abrir caja' }),
    ).toHaveAttribute('href', '/pos/register?next=%2Fpos%2Fsell');
    await scan(app, 'ZAP0101-25-NEG');
    expect(await screen.findByRole('button', { name: 'Agregar desde A-01-01' })).toBeDisabled();
  });
});

describe('PosSalePage: otras sucursales y promoción (T26)', () => {
  it('muestra "Hay en Sucursal 2 (2) · 55 1234 5678"; arriba y resaltado si aquí no hay', async () => {
    start();
    const app = renderApp('/pos/sell');
    await scan(app, 'ZAP0101-25-NEG');
    const others = await screen.findByRole('region', { name: 'En otras sucursales' });
    expect(others).toHaveTextContent('Hay en Sucursal 2 (2) · 55 1234 5678');
    expect(others).not.toHaveClass('font-bold');

    await scan(app, 'ZAP0101-26-NEG');
    const highlighted = await screen.findByRole('region', { name: 'En otras sucursales' });
    await waitFor(() => expect(highlighted).toHaveClass('font-bold'));
    expect(screen.getByText('Sin disponibles en esta sucursal.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Ubicaciones' })).not.toBeInTheDocument();
  });

  it('con otherBranches: null no muestra nada', async () => {
    start({ [lookupKey('ZAP0101-25-CAF')]: ok(makeLocate([caf25])) });
    const app = renderApp('/pos/sell');
    await scan(app, 'ZAP0101-25-CAF');
    await screen.findByRole('list', { name: 'Ubicaciones' });
    expect(screen.queryByRole('region', { name: 'En otras sucursales' })).not.toBeInTheDocument();
  });

  it('un QR de promoción abre el aviso, con la descripción si es el de la sucursal', async () => {
    start();
    const app = renderApp('/pos/sell');
    await scan(app, 'PROMO:DESC10');
    const dialog = await screen.findByRole('dialog', { name: 'Promoción' });
    expect(dialog).toHaveTextContent('Código de promoción: DESC10');
    expect(dialog).toHaveTextContent('Muestra este QR al cajero en tu próxima compra');
    // El Vendedor no tiene pos.discount.
    expect(
      within(dialog).queryByRole('button', { name: 'Aplicar descuento' }),
    ).not.toBeInTheDocument();
    await app.user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

    await scan(app, 'PROMO:OTRA');
    const other = await screen.findByRole('dialog', { name: 'Promoción' });
    expect(other).toHaveTextContent('Código de promoción: OTRA');
    expect(other).not.toHaveTextContent('Muestra este QR');
  });

  it('con pos.discount, "Aplicar descuento" abre el descuento global del carrito', async () => {
    start({}, { role: 'MANAGER' });
    const app = renderApp('/pos/sell');
    await screen.findByText('Carrito #12');
    await scan(app, 'PROMO:DESC10');
    const dialog = await screen.findByRole('dialog', { name: 'Promoción' });
    await app.user.click(within(dialog).getByRole('button', { name: 'Aplicar descuento' }));
    expect(
      await screen.findByRole('dialog', { name: 'Descuento al carrito #12' }),
    ).toBeInTheDocument();
  });
});
