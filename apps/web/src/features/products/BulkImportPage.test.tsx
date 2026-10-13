import type { ImportSummary, PermissionCode } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { setScreenWidth } from '@/test/media';
import { renderApp } from '@/test/renderApp';
import { DESKTOP_ONLY_MESSAGE } from './BulkImportPage';
import { CATALOGS } from './testing';

// react-data-grid busca celdas con el selector anidado `& > …`, que los navegadores aceptan y el
// motor de selectores de jsdom no: en estos tests se traduce a `:scope > …`, su equivalente.
const nativeQuerySelector = Element.prototype.querySelector;
beforeAll(() => {
  Element.prototype.querySelector = function querySelector(this: Element, selectors: string) {
    return nativeQuerySelector.call(this, selectors.replace(/^&/, ':scope'));
  } as typeof Element.prototype.querySelector;
});
afterAll(() => {
  Element.prototype.querySelector = nativeQuerySelector;
});

const VALIDATE = 'POST /api/v1/products/import/validate';
const COMMIT = 'POST /api/v1/products/import/commit';

const summary = (
  overrides: Partial<ImportSummary['stock']['addingToExisting']> = {},
): ImportSummary => ({
  productsToCreate: 1,
  productsToUpdate: 0,
  variantsToCreate: 1,
  variantsToUpdate: 0,
  categoriesToCreate: [],
  brandsToCreate: [],
  stock: {
    units: 3,
    rows: 1,
    unitsToStaging: 3,
    addingToExisting: { units: 0, variants: 0, ...overrides },
  },
});

function start(routes: Parameters<typeof mockFetch>[0] = {}, extra: PermissionCode[] = []) {
  const session = makeSession({ role: 'MANAGER' });
  session.me.permissions = [
    ...session.me.permissions.filter((p) => p !== 'inventory.override_capacity'),
    ...extra,
  ].sort();
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, session),
    'GET /api/v1/products/catalogs': () => jsonResponse(200, CATALOGS),
    ...routes,
  });
}

/**
 * Celda de la fila de datos `n` (1 = primera) en la columna `col` (0 = sku_padre), por los
 * índices ARIA del grid: la fila 1 es el encabezado y la columna 1, el número de fila.
 */
const cell = (n: number, col: number) =>
  document.querySelector<HTMLElement>(
    `[role="row"][aria-rowindex="${n + 1}"] [role="gridcell"][aria-colindex="${col + 2}"]`,
  )!;
const cellTexts = (n: number, count: number) =>
  Array.from({ length: count }, (_, col) => cell(n, col).textContent);

async function paste(app: ReturnType<typeof renderApp>, n: number, col: number, text: string) {
  await app.user.click(cell(n, col));
  await app.user.paste(text);
}

describe('BulkImportPage (T31)', () => {
  it('en el celular pide una computadora', async () => {
    setScreenWidth(375);
    start();
    renderApp('/products/import');
    expect(await screen.findByText(`${DESKTOP_ONLY_MESSAGE}.`)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('en escritorio muestra el grid; "Importar .xlsx" envía el archivo y carga sus filas', async () => {
    const fetchMock = start({
      'POST /api/v1/products/import/parse': () =>
        jsonResponse(200, {
          rows: [
            {
              rowNumber: 2,
              cells: cells({
                sku_padre: 'ACC0301',
                nombre: 'Cinturón',
                tipo: 'simple',
                precio: '349',
              }),
            },
            {
              rowNumber: 5,
              cells: cells({
                sku_padre: 'ACC0302',
                nombre: 'Llavero',
                tipo: 'simple',
                precio: '99',
              }),
            },
          ],
        }),
    });
    const app = renderApp('/products/import');
    expect(await screen.findByRole('grid', { name: 'Carga masiva' })).toBeInTheDocument();

    await app.user.upload(
      screen.getByLabelText('Archivo .xlsx'),
      new File(['xlsx'], 'carga.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    expect(await screen.findByText('2 filas importadas')).toBeInTheDocument();
    expect(cellTexts(1, 2)).toEqual(['ACC0301', 'Cinturón']);
    expect(cellTexts(2, 2)).toEqual(['ACC0302', 'Llavero']);
    const [, init] = callsTo(fetchMock, 'POST /api/v1/products/import/parse')[0]!;
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });
});

function cells(values: Record<string, string>) {
  const all = Object.fromEntries(
    [
      'sku_padre',
      'nombre',
      'categoría',
      'marca',
      'tipo',
      'precio',
      'costo',
      'sku_variante',
      'talla',
      'color',
      'material',
      'precio_variante',
      'existencia',
      'ubicación',
      'activo',
    ].map((c) => [c, '']),
  );
  return { ...all, ...values };
}

describe('BulkImportPage: plantilla', () => {
  it('"Descargar plantilla" pide el .xlsx con el token y lo descarga', async () => {
    const createObjectURL = jest.fn(() => 'blob:plantilla');
    Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = start({
      'GET /api/v1/products/import/template': () =>
        ({ ok: true, status: 200, blob: async () => new Blob(['xlsx']) }) as Response,
    });
    const app = renderApp('/products/import');
    await app.user.click(await screen.findByRole('button', { name: 'Descargar plantilla' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const [, init] = callsTo(fetchMock, 'GET /api/v1/products/import/template')[0]!;
    expect((init as RequestInit).headers).toEqual({
      authorization: expect.stringMatching(/^Bearer /),
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('BulkImportPage: pegado y validación en vivo (T32)', () => {
  it('pegar un TSV de 3 × 4 reparte los valores y agrega filas', async () => {
    start();
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(
      app,
      1,
      0,
      'ACC0301\tCinturón\tAccesorios\tDemo\nACC0302\tLlavero\tAccesorios\tDemo\r\nACC0303\tCartera\tBolsos\tDemo\n',
    );
    expect(cellTexts(1, 4)).toEqual(['ACC0301', 'Cinturón', 'Accesorios', 'Demo']);
    expect(cellTexts(2, 4)).toEqual(['ACC0302', 'Llavero', 'Accesorios', 'Demo']);
    expect(cellTexts(3, 4)).toEqual(['ACC0303', 'Cartera', 'Bolsos', 'Demo']);
  });

  it('una celda inválida se resalta con su mensaje al momento', async () => {
    start();
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, 'ACC0301\tCinturón\t\t\totro\t349');
    const tipo = within(cell(1, 4)).getByText(/otro/);
    expect(tipo).toHaveAttribute('aria-invalid', 'true');
    expect(tipo).toHaveAttribute('title', 'El tipo debe ser simple o variable');
    expect(
      within(screen.getByRole('list', { name: 'Errores' })).getByText(
        'Fila 2 · tipo: El tipo debe ser simple o variable',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 errores en vivo/)).toBeInTheDocument();
  });

  it('categoría y marca autocompletan desde catalogs', async () => {
    start();
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await app.user.dblClick(cell(1, 2));
    const editor = await screen.findByRole('combobox', { name: 'Editar categoría' });
    expect(editor).toHaveAttribute('list', 'import-categories');
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('#import-categories option')].map(
          (o) => (o as HTMLOptionElement).value,
        ),
      ).toEqual(['Calzado', 'Calzado > Dama']),
    );
    expect(
      [...document.querySelectorAll('#import-brands option')].map(
        (o) => (o as HTMLOptionElement).value,
      ),
    ).toEqual(['Demo Calzado']);
  });
});

describe('BulkImportPage: duplicar fila', () => {
  const ROWS =
    'ZAP0101\tZapato\t\t\tvariable\t899\t\tZAP0101-23-NEG\t23\tNegro\n' +
    'ZAP0101\t\t\t\t\t\t\tZAP0101-24-NEG\t24\tNegro';
  const duplicate = (app: ReturnType<typeof renderApp>) =>
    app.user.click(screen.getByRole('button', { name: 'Duplicar fila' }));
  const dataRows = () => screen.getAllByRole('row').length - 1;

  it('copia la fila seleccionada debajo, sin sku_variante, y selecciona la copia', async () => {
    start();
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROWS);
    await app.user.click(cell(1, 8));

    await duplicate(app);
    expect(dataRows()).toBe(3);
    expect(cellTexts(2, 7)).toEqual(cellTexts(1, 7));
    expect(cell(2, 7)).not.toHaveTextContent('ZAP0101');
    expect(cell(2, 7).firstElementChild).toHaveAttribute('aria-invalid', 'true');
    expect(cellTexts(2, 10).slice(8)).toEqual(['23', 'Negro']);
    expect(cell(2, 8)).toHaveAttribute('aria-selected', 'true');
    expect(cell(3, 7)).toHaveTextContent('ZAP0101-24-NEG');

    await duplicate(app);
    expect(dataRows()).toBe(4);
    expect(cell(3, 8)).toHaveTextContent('23');
    expect(cell(3, 8)).toHaveAttribute('aria-selected', 'true');
    expect(cell(4, 8)).toHaveTextContent('24');
  });

  it('sin celda seleccionada duplica la última fila', async () => {
    start({
      'POST /api/v1/products/import/parse': () =>
        jsonResponse(200, {
          rows: [
            { rowNumber: 2, cells: cells({ sku_padre: 'ACC0301', tipo: 'simple' }) },
            { rowNumber: 3, cells: cells({ sku_padre: 'ACC0302', tipo: 'simple' }) },
          ],
        }),
    });
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await app.user.upload(
      screen.getByLabelText('Archivo .xlsx'),
      new File(['xlsx'], 'carga.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    await waitFor(() => expect(dataRows()).toBe(2));

    await duplicate(app);
    expect(dataRows()).toBe(3);
    expect(cell(2, 0)).toHaveTextContent('ACC0302');
    expect(cell(3, 0)).toHaveTextContent('ACC0302');
    expect(cell(3, 0)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('BulkImportPage: validar y aplicar (T33)', () => {
  const ROW = 'NUE0101\tSandalia\t\t\tsimple\t599\t\t\t\t\t\t\t3';
  const apply = () => screen.getByRole('button', { name: 'Aplicar' });

  it('"Aplicar" se habilita tras validar sin errores y se deshabilita al editar', async () => {
    const fetchMock = start({
      [VALIDATE]: () => jsonResponse(200, { issues: [], summary: summary() }),
      [COMMIT]: () => jsonResponse(200, summary()),
    });
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROW);
    expect(apply()).toBeDisabled();

    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    await waitFor(() => expect(apply()).toBeEnabled());
    expect(screen.getByText(/1 nuevos, 0 actualizados/)).toBeInTheDocument();

    await paste(app, 1, 1, 'Sandalia de piel');
    expect(apply()).toBeDisabled();

    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    await waitFor(() => expect(apply()).toBeEnabled());
    await app.user.click(apply());
    expect(await screen.findByText('Carga aplicada', { selector: 'p' })).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, COMMIT)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      allowCapacityOverride: false,
      confirmStockAddition: false,
      rows: [{ rowNumber: 2, cells: { sku_padre: 'NUE0101', nombre: 'Sandalia de piel' } }],
    });
  });

  it('los errores del servidor se muestran en su celda', async () => {
    start({
      [VALIDATE]: () =>
        jsonResponse(200, {
          issues: [{ rowNumber: 2, field: 'sku_padre', message: 'Ese SKU ya está en uso.' }],
          summary: summary(),
        }),
    });
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROW);
    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    const sku = await within(cell(1, 0)).findByText(/NUE0101/);
    await waitFor(() => expect(sku).toHaveAttribute('title', 'Ese SKU ya está en uso.'));
    expect(sku).toHaveAttribute('data-issue', 'server');
    expect(apply()).toBeDisabled();
  });

  it('con addingToExisting la confirmación es obligatoria', async () => {
    start({
      [VALIDATE]: () =>
        jsonResponse(200, { issues: [], summary: summary({ units: 3, variants: 1 }) }),
    });
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROW);
    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    const confirm = await screen.findByRole('checkbox', {
      name: 'Confirmo sumar 3 unidades a 1 variantes que ya tienen stock',
    });
    expect(apply()).toBeDisabled();
    await app.user.click(confirm);
    expect(apply()).toBeEnabled();
  });

  it('"Permitir exceder capacidad" solo con inventory.override_capacity', async () => {
    start();
    renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    expect(
      screen.queryByRole('checkbox', { name: 'Permitir exceder capacidad' }),
    ).not.toBeInTheDocument();
  });

  it('con el permiso aparece y viaja en la validación', async () => {
    const fetchMock = start(
      { [VALIDATE]: () => jsonResponse(200, { issues: [], summary: summary() }) },
      ['inventory.override_capacity'],
    );
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROW);
    await app.user.click(screen.getByRole('checkbox', { name: 'Permitir exceder capacidad' }));
    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    await waitFor(() => expect(callsTo(fetchMock, VALIDATE)).toHaveLength(1));
    const [, init] = callsTo(fetchMock, VALIDATE)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      allowCapacityOverride: true,
    });
  });

  it('un IMPORT_INVALID al aplicar marca las celdas', async () => {
    start({
      [VALIDATE]: () => jsonResponse(200, { issues: [], summary: summary() }),
      [COMMIT]: () =>
        apiError(400, 'IMPORT_INVALID', 'La carga tiene errores.', [
          { rowNumber: 2, field: 'precio', message: 'Precio rechazado' },
        ]),
    });
    const app = renderApp('/products/import');
    await screen.findByRole('grid', { name: 'Carga masiva' });
    await paste(app, 1, 0, ROW);
    await app.user.click(screen.getByRole('button', { name: 'Validar en servidor' }));
    await waitFor(() => expect(apply()).toBeEnabled());
    await app.user.click(apply());
    await waitFor(() =>
      expect(within(cell(1, 5)).getByText(/599/)).toHaveAttribute('title', 'Precio rechazado'),
    );
  });
});
