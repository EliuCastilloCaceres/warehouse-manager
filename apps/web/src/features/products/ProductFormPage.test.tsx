import { screen, waitFor, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { setScreenWidth } from '@/test/media';
import { renderApp } from '@/test/renderApp';
import { CATALOGS, makeDetail, makeVariant } from './testing';

function start(routes: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ role: 'MANAGER' })),
    'GET /api/v1/products/catalogs': () => jsonResponse(200, CATALOGS),
    ...routes,
  });
}

const bodyOf = (fetchMock: jest.Mock, key: string) => {
  const [, init] = callsTo(fetchMock, key).at(-1)!;
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
};

describe('ProductFormPage (T29)', () => {
  it('SIMPLE muestra "Código de barras" y oculta las variantes; VARIABLE muestra el generador', async () => {
    start();
    const app = renderApp('/products/new');
    expect(await screen.findByRole('textbox', { name: 'Tallas' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Código de barras')).not.toBeInTheDocument();

    await app.user.click(screen.getByRole('radio', { name: 'Simple' }));
    expect(screen.getByLabelText('Código de barras')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Tallas' })).not.toBeInTheDocument();
  });

  it('envía los precios en centavos y abre el producto creado', async () => {
    const created = makeDetail({ sku: 'ACC0301', type: 'SIMPLE' });
    const fetchMock = start({
      'POST /api/v1/products': () => jsonResponse(201, created),
      [`GET /api/v1/products/${created.id}`]: () => jsonResponse(200, created),
    });
    const app = renderApp('/products/new');
    await app.user.click(await screen.findByRole('radio', { name: 'Simple' }));
    await app.user.type(screen.getByLabelText('SKU'), 'acc0301');
    await app.user.type(screen.getByLabelText('Nombre'), 'Cinturón');
    await app.user.type(screen.getByLabelText('Precio ($)'), '$1,299.50');
    await app.user.type(screen.getByLabelText('Costo ($)'), '450');
    await app.user.type(screen.getByLabelText('Código de barras'), '7501234567890');
    await app.user.click(screen.getByRole('button', { name: 'Crear producto' }));

    await waitFor(() => expect(app.location()).toBe(`/products/${created.id}`));
    expect(bodyOf(fetchMock, 'POST /api/v1/products')).toMatchObject({
      sku: 'ACC0301',
      name: 'Cinturón',
      type: 'SIMPLE',
      price: 129950,
      cost: 45000,
      barcode: '7501234567890',
      variants: [],
    });
  });

  it('un precio inválido no llama a la API', async () => {
    const fetchMock = start();
    const app = renderApp('/products/new');
    await app.user.type(await screen.findByLabelText('Precio ($)'), 'abc');
    await app.user.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(
      await screen.findByText('Escribe un importe en pesos, p. ej. 899.00'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /api/v1/products')).toHaveLength(0);
  });

  it('un 409 SKU_TAKEN marca el campo de details.field', async () => {
    const product = makeDetail();
    start({
      [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product),
      [`PUT /api/v1/products/${product.id}`]: () =>
        apiError(409, 'SKU_TAKEN', 'Ese SKU ya está en uso.', {
          sku: 'ZAP0101-26-NEG',
          field: 'variants.1.sku',
        }),
    });
    const app = renderApp(`/products/${product.id}`);
    await app.user.click(await screen.findByRole('button', { name: 'Guardar' }));
    const sku = await screen.findByRole('textbox', { name: 'SKU de la variante 2' });
    await waitFor(() => expect(sku).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Ese SKU ya está en uso.')).toBeInTheDocument();
  });

  it('con historial el tipo está bloqueado y "Eliminar" no aparece', async () => {
    const product = makeDetail({ hasHistory: true });
    start({ [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product) });
    renderApp(`/products/${product.id}`);
    expect(await screen.findByRole('radio', { name: 'Simple' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Con variantes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('sin historial ofrece "Eliminar" con confirmación', async () => {
    const product = makeDetail();
    const fetchMock = start({
      [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product),
      [`DELETE /api/v1/products/${product.id}`]: () => jsonResponse(204),
      'GET /api/v1/products?page=1&pageSize=20&isActive=true': () =>
        jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }),
    });
    const app = renderApp(`/products/${product.id}`);
    await app.user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await app.user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }),
    );
    await waitFor(() => expect(app.location()).toBe('/products'));
    expect(callsTo(fetchMock, `DELETE /api/v1/products/${product.id}`)).toHaveLength(1);
  });

  it('un 409 VARIANT_HAS_HISTORY ofrece "Desactivar variante"', async () => {
    const product = makeDetail();
    const locked = product.variants[1]!;
    const fetchMock = start({
      [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product),
      [`PUT /api/v1/products/${product.id}`]: () =>
        apiError(409, 'VARIANT_HAS_HISTORY', 'La variante tiene movimientos o ventas.', {
          variantId: locked.id,
          sku: locked.sku,
        }),
      [`POST /api/v1/products/${product.id}/variants/${locked.id}/deactivate`]: () =>
        jsonResponse(200, {
          ...product,
          variants: [product.variants[0], makeVariant(product.id, { ...locked, isActive: false })],
        }),
    });
    const app = renderApp(`/products/${product.id}`);
    await app.user.click(
      await screen.findByRole('button', { name: `Quitar la variante ${locked.sku}` }),
    );
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(locked.sku);
    await app.user.click(within(alert).getByRole('button', { name: 'Desactivar variante' }));

    await waitFor(() =>
      expect(
        callsTo(fetchMock, `POST /api/v1/products/${product.id}/variants/${locked.id}/deactivate`),
      ).toHaveLength(1),
    );
    // La variante vuelve a la tabla (sigue en el producto) y el aviso desaparece.
    expect(await screen.findByRole('textbox', { name: 'SKU de la variante 2' })).toHaveValue(
      locked.sku,
    );
    expect(screen.queryByRole('button', { name: 'Desactivar variante' })).not.toBeInTheDocument();
  });

  it('las variantes nuevas reciben el SKU sugerido al cambiar el SKU padre', async () => {
    start();
    const app = renderApp('/products/new');
    await app.user.type(await screen.findByRole('textbox', { name: 'Tallas' }), '25{Enter}');
    await app.user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));
    await app.user.type(screen.getByLabelText('SKU'), 'zap0101');
    expect(screen.getByRole('textbox', { name: 'SKU de la variante 1' })).toHaveValue('ZAP0101-25');
  });

  it('en el celular las variantes se muestran como tarjetas, no como tabla', async () => {
    setScreenWidth(375);
    const product = makeDetail();
    start({ [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product) });
    const app = renderApp(`/products/${product.id}`);

    const list = await screen.findByRole('list', { name: 'Variantes' });
    expect(screen.queryByRole('table', { name: 'Variantes' })).not.toBeInTheDocument();
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole('textbox', { name: 'SKU de la variante 1' })).toHaveValue(
      product.variants[0]!.sku,
    );
    expect(within(cards[0]!).getByText('Talla')).toBeInTheDocument();
    expect(
      within(cards[1]!).getByRole('checkbox', {
        name: `Variante ${product.variants[1]!.sku} activa`,
      }),
    ).toBeChecked();

    await app.user.click(
      within(cards[1]!).getByRole('button', {
        name: `Quitar la variante ${product.variants[1]!.sku}`,
      }),
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });
});
