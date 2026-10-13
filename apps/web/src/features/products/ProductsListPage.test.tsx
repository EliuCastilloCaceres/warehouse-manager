import type { PermissionCode, SystemRoleCode } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { PRODUCT_NOT_FOUND, WRONG_CODE_MESSAGES } from './ProductsListPage';
import { CATALOGS, makeDetail, makeListItem, productsKey } from './testing';

const zap = makeListItem({ thumbUrl: '/uploads/product/zap.thumb.webp' });
const acc = makeListItem({
  sku: 'ACC0301',
  name: 'Cinturón',
  type: 'SIMPLE',
  variantCount: 1,
  totalStock: 0,
});
const page = (items: ReturnType<typeof makeListItem>[]) => () =>
  jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });
const LOOKUP = (code: string) => `GET /api/v1/products/lookup?${new URLSearchParams({ code })}`;

function start(role: SystemRoleCode = 'MANAGER', extra: PermissionCode[] = []) {
  const session = makeSession({ role });
  session.me.permissions = [...session.me.permissions, ...extra].sort();
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, session),
    'GET /api/v1/products/catalogs': () => jsonResponse(200, CATALOGS),
    [productsKey()]: page([zap, acc]),
    [productsKey({ q: 'cintu' })]: page([acc]),
    [LOOKUP('ZAP0101-25-NEG')]: () =>
      jsonResponse(200, {
        match: 'variant',
        product: zap,
        variant: makeDetail({ id: zap.id }).variants[0],
      }),
    [LOOKUP('NOEXISTE')]: () => apiError(404, 'NOT_FOUND', 'No se encontró el producto.'),
  });
}

const scan = async (app: ReturnType<typeof renderApp>, code: string) => {
  const field = await screen.findByLabelText('Escanear producto');
  await app.user.type(field, `${code}{Enter}`);
};

describe('ProductsListPage (T27)', () => {
  it('lista los productos con imagen, variantes y existencia', async () => {
    start();
    renderApp('/products');
    const table = await screen.findByRole('table', { name: 'Productos' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('ZAP0101');
    expect(rows[1]).toHaveTextContent('2 variantes · 5 pzas');
    expect(rows[2]).toHaveTextContent('1 variante · 0 pzas');
  });

  it('la búsqueda envía q', async () => {
    const fetchMock = start();
    const app = renderApp('/products');
    await screen.findByText('Cinturón');
    await app.user.type(screen.getByRole('searchbox', { name: 'Buscar productos' }), 'cintu');
    await waitFor(() => expect(callsTo(fetchMock, productsKey({ q: 'cintu' }))).toHaveLength(1));
  });

  it('un escaneo de producto llama a lookup y navega al detalle', async () => {
    const fetchMock = start();
    const app = renderApp('/products');
    await scan(app, 'zap0101-25-neg');
    await waitFor(() => expect(app.location()).toBe(`/products/${zap.id}`));
    expect(callsTo(fetchMock, LOOKUP('ZAP0101-25-NEG'))).toHaveLength(1);
  });

  it('un SKU inexistente avisa "No se encontró el producto"', async () => {
    start();
    const app = renderApp('/products');
    await scan(app, 'NOEXISTE');
    expect(await screen.findByText(PRODUCT_NOT_FOUND)).toBeInTheDocument();
  });

  it.each([
    ['ubicación', 'LOC:A-01-03', WRONG_CODE_MESSAGES.location],
    ['promoción', 'PROMO:DESC10', WRONG_CODE_MESSAGES.promo],
  ])('un escaneo de %s muestra su aviso sin llamar a lookup', async (_caso, code, message) => {
    const fetchMock = start();
    const app = renderApp('/products');
    await scan(app, code);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/lookup'))).toHaveLength(0);
  });

  it('"Nuevo" y "Carga masiva" dependen de products.manage y products.import', async () => {
    start('SELLER');
    renderApp('/products');
    await screen.findByText('Cinturón');
    expect(screen.queryByRole('button', { name: 'Nuevo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carga masiva' })).not.toBeInTheDocument();
  });

  it('con los permisos aparecen y navegan', async () => {
    start('MANAGER');
    const app = renderApp('/products');
    expect(await screen.findByRole('button', { name: 'Carga masiva' })).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Nuevo' }));
    expect(app.location()).toBe('/products/new');
  });
});
