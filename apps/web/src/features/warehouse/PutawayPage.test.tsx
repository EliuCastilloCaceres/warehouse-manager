import { screen, waitFor, within } from '@testing-library/react';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  byLocationKey,
  locateKey,
  makeContent,
  makeLocate,
  makeLocateVariant,
  ok,
  suggestKey,
  uuid,
  warehouseRoutes,
} from './testing';

const PUTAWAY = 'POST /api/v1/inventory/putaway';
const BATCH = 'POST /api/v1/inventory/putaway/batch';

// NEG: 2 disponibles en staging. CAF: sin staging.
const neg = makeLocateVariant('ZAP0101-25-NEG');
const caf = makeLocateVariant('ZAP0101-26-CAF', {
  locations: [neg.locations[0]!],
  stock: { status: 'BAJO', enPiso: false, enStaging: false },
});
const rackA1 = uuid('bbbbbbbb');
const rackA2 = uuid('bbbbbbbb');
const done = ok({ movements: [], balances: [] });

function start(extra: object = {}, options: Parameters<typeof warehouseRoutes>[1] = {}) {
  return mockFetch(
    warehouseRoutes(
      {
        [locateKey('ZAP0101-25-NEG')]: ok(makeLocate([neg])),
        [locateKey('ZAP0101-26-CAF')]: ok(makeLocate([caf])),
        [suggestKey(neg.variant.id, 2)]: ok({
          fitsAll: true,
          suggestions: [
            {
              rackId: rackA1,
              locationCode: 'A-01-01',
              zoneName: 'Calzado dama',
              colorHex: '#2563EB',
              free: 30,
              level: 'green',
              reason: 'SAME_VARIANT',
            },
          ],
        }),
        [suggestKey(caf.variant.id, 1)]: ok({ fitsAll: false, suggestions: [] }),
        [byLocationKey('A-01-02')]: ok(makeContent({ id: rackA2, code: 'A-01-02' }, [])),
        [byLocationKey('STG-01-01')]: ok(
          makeContent({ id: uuid('bbbbbbbb'), code: 'STG-01-01', isStaging: true }, []),
        ),
        [PUTAWAY]: done,
        [BATCH]: done,
        ...extra,
      },
      options,
    ),
  );
}

const scan = async (app: ReturnType<typeof renderApp>, label: string, code: string) =>
  app.user.type(await screen.findByLabelText(label), `${code}{Enter}`);
const bodyOf = (fetchMock: jest.Mock, key: string, i = 0) =>
  JSON.parse(callsTo(fetchMock, key)[i]![1].body as string);
const quantityField = (name = 'Cantidad') =>
  screen.getByRole('textbox', { name }) as HTMLInputElement;

describe('PutawayPage: producto primero (T31)', () => {
  const PRODUCT = 'Escanear producto o ubicación';

  it('tras escanear muestra sugerencias; tocar una la elige y "Confirmar" envía PutawayInput', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/putaway');
    await scan(app, PRODUCT, 'ZAP0101-25-NEG');

    const suggestions = await screen.findByRole('list', { name: 'Sugerencias' });
    const option = within(suggestions).getByRole('button', {
      name: /A-01-01 · 30 libres · ya está aquí/,
    });
    // Con unidades en staging, el origen por defecto es staging y la cantidad, lo que hay.
    expect(screen.getByRole('button', { name: 'Desde staging (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(quantityField().value).toBe('2');

    await app.user.click(option);
    expect(screen.getByText('A-01-01')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Menos (Cantidad)' }));
    expect(quantityField().value).toBe('1');
    expect(screen.getByRole('button', { name: 'Más (Cantidad)' })).toBeEnabled();

    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(callsTo(fetchMock, PUTAWAY)).toHaveLength(1));
    expect(bodyOf(fetchMock, PUTAWAY)).toEqual({
      variantId: neg.variant.id,
      rackId: rackA1,
      quantity: 1,
      source: 'STAGING',
      overrideCapacity: false,
    });
  });

  it('escanear una ubicación la elige; sin staging el origen es "Mercancía nueva"', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/putaway');
    await scan(app, PRODUCT, 'ZAP0101-26-CAF');
    expect(await screen.findByText(/Ningún rack tiene espacio para 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desde staging (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mercancía nueva' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await scan(app, PRODUCT, 'LOC:STG-01-01');
    expect(await screen.findByText('El destino no puede ser staging')).toBeInTheDocument();
    await scan(app, PRODUCT, 'LOC:A-01-02');
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Más (Cantidad)' }));
    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(callsTo(fetchMock, PUTAWAY)).toHaveLength(1));
    expect(bodyOf(fetchMock, PUTAWAY)).toMatchObject({
      rackId: rackA2,
      quantity: 2,
      source: 'NEW',
    });
  });
});

describe('PutawayPage: ubicación primero (T32)', () => {
  const FIELD = 'Escanear ubicación o producto';

  const fill = async (app: ReturnType<typeof renderApp>) => {
    await app.user.click(await screen.findByRole('button', { name: 'Ubicación primero' }));
    await scan(app, FIELD, 'LOC:A-01-02');
    await screen.findByText('A-01-02');
    for (const code of ['ZAP0101-25-NEG', 'ZAP0101-25-NEG', 'ZAP0101-26-CAF', 'ZAP0101-25-NEG']) {
      await scan(app, FIELD, code);
    }
  };

  it('3 escaneos de una variante y 1 de otra → 2 filas; "Confirmar lote" envía el lote', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/putaway');
    await fill(app);
    const list = await screen.findByRole('list', { name: 'Productos a ubicar' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(quantityField('Cantidad de ZAP0101-25-NEG').value).toBe('3');
    expect(quantityField('Cantidad de ZAP0101-26-CAF').value).toBe('1');
    expect(callsTo(fetchMock, locateKey('ZAP0101-25-NEG'))).toHaveLength(1);

    await app.user.click(screen.getByRole('button', { name: 'Más (Cantidad de ZAP0101-26-CAF)' }));
    await app.user.click(screen.getByRole('button', { name: 'Confirmar lote' }));
    await waitFor(() => expect(callsTo(fetchMock, BATCH)).toHaveLength(1));
    expect(bodyOf(fetchMock, BATCH)).toEqual({
      rackId: rackA2,
      overrideCapacity: false,
      items: [
        { variantId: neg.variant.id, quantity: 3, source: 'STAGING' },
        { variantId: caf.variant.id, quantity: 2, source: 'NEW' },
      ],
    });
  });

  const exceeded = () =>
    apiError(409, 'RACK_CAPACITY_EXCEEDED', 'El rack no tiene capacidad suficiente.', {
      rackId: rackA2,
      locationCode: 'A-01-02',
      capacity: 40,
      occupied: 38,
      requested: 3,
      itemIndex: 0,
    });

  it('un 409 de capacidad ofrece "Exceder capacidad" con el permiso y reintenta con override', async () => {
    const fetchMock = start({ [BATCH]: [exceeded, done] });
    const app = renderApp('/warehouse/putaway');
    await fill(app);
    await app.user.click(await screen.findByRole('button', { name: 'Confirmar lote' }));
    expect(
      await screen.findByText('A-01-02 no tiene espacio (38/40, entran 2)'),
    ).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Exceder capacidad' }));
    await waitFor(() => expect(callsTo(fetchMock, BATCH)).toHaveLength(2));
    expect(bodyOf(fetchMock, BATCH, 1).overrideCapacity).toBe(true);
  });

  it('sin inventory.override_capacity solo ofrece "Elegir otra ubicación"', async () => {
    start({ [BATCH]: exceeded }, { role: 'WAREHOUSE_CLERK' });
    const app = renderApp('/warehouse/putaway');
    await fill(app);
    await app.user.click(await screen.findByRole('button', { name: 'Confirmar lote' }));
    await screen.findByText('A-01-02 no tiene espacio (38/40, entran 2)');
    expect(screen.queryByRole('button', { name: 'Exceder capacidad' })).not.toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Elegir otra ubicación' }));
    await waitFor(() => expect(screen.queryByText(/no tiene espacio/)).not.toBeInTheDocument());
  });
});

describe('PutawayPage: escaneos inválidos y edición de filas', () => {
  const PRODUCT = 'Escanear producto o ubicación';
  const FIELD = 'Escanear ubicación o producto';
  const errors = {
    [locateKey('ZAP0101')]: ok(makeLocate([neg, caf])),
    [locateKey('NOEXISTE')]: () => apiError(404, 'NOT_FOUND', 'No se encontró el producto.'),
    [locateKey('FALLA')]: () => apiError(500, 'INTERNAL_ERROR', 'Error del servidor.'),
    [locateKey('A-01-02')]: () => apiError(404, 'NOT_FOUND', 'No se encontró el producto.'),
    [byLocationKey('Z-01-01')]: () => apiError(404, 'NOT_FOUND', 'No existe.'),
    [byLocationKey('A-01-09')]: () => apiError(500, 'INTERNAL_ERROR', 'Error del servidor.'),
  };

  it('producto primero: avisos de escaneo, SKU padre y cambiar el destino', async () => {
    start(errors);
    const app = renderApp('/warehouse/putaway');
    await scan(app, PRODUCT, 'LOC:A-01-02');
    expect(await screen.findByText('Escanea el código de un producto')).toBeInTheDocument();
    // Sin producto elegido, "A-01-02" tecleado se busca como SKU.
    await scan(app, PRODUCT, 'A-01-02');
    expect(await screen.findByText('No se encontró el producto')).toBeInTheDocument();
    await scan(app, PRODUCT, 'PROMO:DESC10');
    expect(await screen.findByText(/es de una promoción/)).toBeInTheDocument();
    await scan(app, PRODUCT, 'NOEXISTE');
    expect(await screen.findByText('No se encontró el producto')).toBeInTheDocument();
    await scan(app, PRODUCT, 'FALLA');
    expect(await screen.findByText('Error del servidor.')).toBeInTheDocument();

    await scan(app, PRODUCT, 'ZAP0101');
    const variants = await screen.findByRole('list', { name: 'Variantes' });
    await app.user.click(within(variants).getByRole('button', { name: /ZAP0101-25-NEG/ }));
    await screen.findByRole('list', { name: 'Sugerencias' });
    await scan(app, PRODUCT, 'LOC:Z-01-01');
    expect(await screen.findByText('No existe esa ubicación en la sucursal')).toBeInTheDocument();
    await scan(app, PRODUCT, 'LOC:A-01-09');
    expect(await screen.findAllByText('Error del servidor.')).not.toHaveLength(0);

    // Con el producto elegido, el destino tecleado sin LOC: también sirve.
    await scan(app, PRODUCT, 'a-1-2');
    await screen.findByText('A-01-02');
    await app.user.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByRole('list', { name: 'Sugerencias' })).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Mercancía nueva' }));
    await app.user.click(screen.getByRole('button', { name: 'Desde staging (2)' }));
    expect(quantityField().value).toBe('2');
  });

  it('ubicación primero: producto antes que ubicación, staging, SKU padre y quitar filas', async () => {
    const fetchMock = start(errors);
    const app = renderApp('/warehouse/putaway?mode=location');
    await scan(app, FIELD, 'ZAP0101-25-NEG');
    expect(await screen.findByText('Escanea primero la ubicación')).toBeInTheDocument();
    await scan(app, FIELD, 'PROMO:DESC10');
    expect(await screen.findByText(/es de una promoción/)).toBeInTheDocument();
    await scan(app, FIELD, 'LOC:STG-01-01');
    expect(await screen.findByText('El destino no puede ser staging')).toBeInTheDocument();
    await scan(app, FIELD, 'LOC:Z-01-01');
    expect(await screen.findByText('No existe esa ubicación en la sucursal')).toBeInTheDocument();

    // Sin ubicación todavía, la tecleada sin LOC: también sirve.
    await scan(app, FIELD, 'a-1-2');
    await screen.findByText('A-01-02');
    await scan(app, FIELD, 'NOEXISTE');
    expect(await screen.findByText('No se encontró el producto')).toBeInTheDocument();
    await scan(app, FIELD, 'ZAP0101');
    const variants = await screen.findByRole('list', { name: 'Variantes' });
    await app.user.click(within(variants).getByRole('button', { name: /ZAP0101-26-CAF/ }));
    // Ya con ubicación, "A-01-02" tecleado se busca como SKU.
    await scan(app, FIELD, 'A-01-02');
    expect(await screen.findByText('No se encontró el producto')).toBeInTheDocument();
    await scan(app, FIELD, 'ZAP0101-25-NEG');
    const list = await screen.findByRole('list', { name: 'Productos a ubicar' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));

    // NEG trae staging: se cambia su origen a mercancía nueva; CAF se quita.
    const negRow = within(list).getAllByRole('listitem')[1]!;
    await app.user.click(within(negRow).getByRole('button', { name: 'Mercancía nueva' }));
    await app.user.click(screen.getByRole('button', { name: 'Quitar ZAP0101-26-CAF' }));
    await app.user.click(screen.getByRole('button', { name: 'Confirmar lote' }));
    await waitFor(() => expect(callsTo(fetchMock, BATCH)).toHaveLength(1));
    expect(bodyOf(fetchMock, BATCH).items).toEqual([
      { variantId: neg.variant.id, quantity: 1, source: 'NEW' },
    ]);
  });

  it('cambiar de modo limpia la pantalla', async () => {
    start();
    const app = renderApp('/warehouse/putaway?mode=location');
    await app.user.click(await screen.findByRole('button', { name: 'Producto primero' }));
    expect(app.location()).toBe('/warehouse/putaway');
    expect(await screen.findByLabelText(PRODUCT)).toBeInTheDocument();
  });
});
