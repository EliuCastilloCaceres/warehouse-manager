import type { LabelDataDto } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { choose } from '@/features/users/testing';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { makeSession } from '@/test/fixtures';
import { callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeDetail, makeListItem, productsKey } from './testing';

// JsBarcode (Code128) mide el texto con un canvas, que jsdom no implementa.
beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        measureText: (text: string) => ({ width: text.length * 8 }),
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterAll(() => {
  jest.restoreAllMocks();
});

const product = makeDetail();
const [v25, v26] = product.variants;
const LABELS = 'POST /api/v1/products/labels';
const LOOKUP = (code: string) => `GET /api/v1/products/lookup?${new URLSearchParams({ code })}`;

/** Respuesta de `/labels` según lo pedido, con imagen para la talla 25. */
function labelsFor(init: RequestInit): LabelDataDto[] {
  const { items } = JSON.parse(init.body as string) as {
    items: { variantId: string; quantity: number }[];
  };
  return items.map(({ variantId, quantity }) => {
    const variant = product.variants.find((v) => v.id === variantId)!;
    return {
      variantId,
      quantity,
      sku: variant.sku,
      productName: product.name,
      variantLabel: `${variant.size} · Negro`,
      price: 89900,
      thumbUrl: variant === v25 ? '/uploads/product/zap.thumb.webp' : null,
    };
  });
}

function start() {
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ role: 'MANAGER' })),
    [LOOKUP(v25!.sku)]: () =>
      jsonResponse(200, {
        match: 'variant',
        product: makeListItem({ id: product.id }),
        variant: v25,
      }),
    [productsKey({ q: 'zapato' })]: () =>
      jsonResponse(200, {
        items: [makeListItem({ id: product.id })],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    [`GET /api/v1/products/${product.id}`]: () => jsonResponse(200, product),
    [LABELS]: (init) => jsonResponse(200, labelsFor(init)),
  });
}

const preview = () => screen.getByTestId('labels-preview');

async function addByScan(app: ReturnType<typeof renderApp>) {
  await app.user.type(await screen.findByLabelText('Escanear variante'), `${v25!.sku}{Enter}`);
  await within(await screen.findByRole('list', { name: 'Etiquetas a imprimir' })).findByText(
    v25!.sku,
  );
}

describe('LabelsPage (T34)', () => {
  it('agrega por escaneo y por búsqueda; la cantidad multiplica las etiquetas', async () => {
    start();
    const app = renderApp('/products/labels');
    await addByScan(app);

    await app.user.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'zapato');
    await app.user.click(
      await within(await screen.findByRole('list', { name: 'Resultados' })).findByRole('button'),
    );
    await app.user.click(await screen.findByRole('button', { name: `Agregar ${v26!.sku}` }));

    const quantity = screen.getByLabelText(`Cantidad de ${v25!.sku}`);
    await app.user.clear(quantity);
    await app.user.type(quantity, '3');
    await waitFor(() => expect(within(preview()).getAllByTestId('label')).toHaveLength(4));
  });

  it('"Mostrar precio" agrega el precio', async () => {
    start();
    const app = renderApp('/products/labels');
    await addByScan(app);
    await waitFor(() => expect(within(preview()).getAllByTestId('label')).toHaveLength(1));
    expect(within(preview()).queryByText('$899.00')).not.toBeInTheDocument();
    await app.user.click(screen.getByRole('checkbox', { name: 'Mostrar precio' }));
    expect(within(preview()).getByText('$899.00')).toBeInTheDocument();
  });

  it('"Imprimir" monta PrintLayout del formato y llama a window.print', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    const fetchMock = start();
    const app = renderApp('/products/labels');
    await addByScan(app);
    await waitFor(() => expect(callsTo(fetchMock, LABELS).length).toBeGreaterThan(0));
    await app.user.click(screen.getByRole('button', { name: 'Imprimir' }));

    const root = document.getElementById(PRINT_ROOT_ID)!;
    await waitFor(() =>
      expect(root.querySelector('[data-print-size="label-50x25"]')).not.toBeNull(),
    );
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(root.querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });

  it('un código de ubicación avisa sin agregar nada', async () => {
    start();
    const app = renderApp('/products/labels');
    await app.user.type(await screen.findByLabelText('Escanear variante'), 'LOC:A-01-03{Enter}');
    expect(
      await screen.findByText('Este código es de una ubicación, no de un producto'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Etiquetas a imprimir' })).not.toBeInTheDocument();
  });
});

describe('LabelsPage: formatos (T35)', () => {
  it('50×25: QR con el SKU sin prefijo, el SKU en texto y sin imagen', async () => {
    start();
    const app = renderApp('/products/labels');
    await addByScan(app);
    const label = (
      await within(await screen.findByTestId('labels-preview')).findAllByTestId('label')
    )[0]!;
    expect(label.querySelector('[data-code="qr"] svg')).toHaveAttribute('aria-label', v25!.sku);
    expect(within(label).getByText(v25!.sku)).toBeInTheDocument();
    expect(label.querySelector('img')).toBeNull();
  });

  it('4×6: imagen y código de barras', async () => {
    start();
    const app = renderApp('/products/labels');
    await addByScan(app);
    await screen.findByTestId('labels-preview');
    await choose(app.user, 'Formato', '4×6"');
    const label = (await within(preview()).findAllByTestId('label'))[0]!;
    expect(label.querySelector('img')).toHaveAttribute('src', '/uploads/product/zap.thumb.webp');
    expect(label.querySelector('[data-code="barcode"] svg')).toHaveAttribute(
      'aria-label',
      v25!.sku,
    );
    expect(label.querySelector('[data-code="qr"]')).toBeNull();
  });

  it.each([
    ['Hoja A4 (24 por hoja)', '210mm'],
    ['Hoja Carta (24 por hoja)', '8.5in'],
  ])('%s: 24 por hoja (25 → 2 hojas), con imagen y código de barras', async (format, width) => {
    start();
    const app = renderApp('/products/labels');
    await addByScan(app);
    const quantity = screen.getByLabelText(`Cantidad de ${v25!.sku}`);
    await app.user.clear(quantity);
    await app.user.type(quantity, '25');
    await screen.findByTestId('labels-preview');
    await choose(app.user, 'Formato', format);

    await waitFor(() => expect(within(preview()).getAllByTestId('label-sheet')).toHaveLength(2));
    const [first, second] = within(preview()).getAllByTestId('label-sheet');
    expect(first).toHaveStyle({ width });
    expect(first!.querySelectorAll('[data-label="sheet"]')).toHaveLength(24);
    expect(second!.querySelectorAll('[data-label="sheet"]')).toHaveLength(1);
    expect(first!.querySelector('img')).not.toBeNull();
    expect(first!.querySelector('[data-code="barcode"] svg')).not.toBeNull();
  });
});
