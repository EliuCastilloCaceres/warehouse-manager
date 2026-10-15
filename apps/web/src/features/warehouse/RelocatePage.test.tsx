import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { SAME_RACK_MESSAGE } from './RelocatePage';
import { byLocationKey, makeContent, makeRow, ok, uuid, warehouseRoutes } from './testing';

const RELOCATE = 'POST /api/v1/inventory/relocate';
const origin = uuid('bbbbbbbb');
const destination = uuid('bbbbbbbb');
const neg = makeRow({ sku: 'ZAP0101-25-NEG', quantity: 5, reservedQty: 2, available: 3 });
const caf = makeRow({ sku: 'ZAP0101-25-CAF', quantity: 2, available: 2 });

function start() {
  return mockFetch(
    warehouseRoutes({
      [byLocationKey('A-01-01')]: ok(makeContent({ id: origin, code: 'A-01-01' }, [neg, caf])),
      [byLocationKey('A-01-02')]: ok(makeContent({ id: destination, code: 'A-01-02' }, [])),
      [RELOCATE]: ok({ movements: [], balances: [] }),
    }),
  );
}

const scan = async (app: ReturnType<typeof renderApp>, code: string) =>
  app.user.type(await screen.findByLabelText('Escanear ubicación'), `${code}{Enter}`);
const bodyOf = (fetchMock: jest.Mock) =>
  JSON.parse(callsTo(fetchMock, RELOCATE)[0]![1].body as string);

describe('RelocatePage (T33)', () => {
  it('origen → marcar ítems y ajustar cantidades → destino → "Confirmar" envía RelocateInput', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/relocate');
    await scan(app, 'LOC:A-01-01');
    const list = await screen.findByRole('list', { name: 'Productos del origen' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('3 disponibles (2 en piso se quedan)');

    await app.user.click(screen.getByRole('checkbox', { name: 'Mover ZAP0101-25-NEG' }));
    const quantity = screen.getByRole('textbox', {
      name: 'Cantidad de ZAP0101-25-NEG',
    }) as HTMLInputElement;
    expect(quantity.value).toBe('3');
    expect(screen.getByRole('button', { name: 'Más (Cantidad de ZAP0101-25-NEG)' })).toBeDisabled();
    await app.user.click(
      screen.getByRole('button', { name: 'Menos (Cantidad de ZAP0101-25-NEG)' }),
    );
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();

    await scan(app, 'LOC:A-01-02');
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(callsTo(fetchMock, RELOCATE)).toHaveLength(1));
    expect(bodyOf(fetchMock)).toEqual({
      fromRackId: origin,
      toRackId: destination,
      overrideCapacity: false,
      items: [{ variantId: neg.variantId, quantity: 2 }],
    });
  });

  it('"Todo" envía all: true', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/relocate');
    await scan(app, 'LOC:A-01-01');
    await app.user.click(await screen.findByRole('button', { name: 'Todo' }));
    expect(screen.getByRole('checkbox', { name: 'Mover ZAP0101-25-CAF' })).toBeChecked();
    await scan(app, 'LOC:A-01-02');
    await screen.findByText('A-01-02');
    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(callsTo(fetchMock, RELOCATE)).toHaveLength(1));
    expect(bodyOf(fetchMock)).toEqual({
      fromRackId: origin,
      toRackId: destination,
      overrideCapacity: false,
      all: true,
    });
  });

  it('un destino igual al origen muestra el error sin llamar a la API', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/relocate');
    await scan(app, 'LOC:A-01-01');
    await screen.findByRole('list', { name: 'Productos del origen' });
    await scan(app, 'ZAP0101-25-NEG');
    expect(await screen.findByText('Escanea el código de una ubicación')).toBeInTheDocument();
    await scan(app, 'LOC:a-1-1');
    expect(await screen.findByText(SAME_RACK_MESSAGE)).toBeInTheDocument();
    expect(callsTo(fetchMock, byLocationKey('A-01-01'))).toHaveLength(1);
    expect(callsTo(fetchMock, RELOCATE)).toHaveLength(0);
  });

  it('el código tecleado sin LOC: ("a-1-1", "A-01-02") sirve de origen y de destino', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/relocate');
    await scan(app, 'a-1-1');
    await app.user.click(await screen.findByRole('button', { name: 'Todo' }));
    await scan(app, 'a-1-1');
    expect(await screen.findByText(SAME_RACK_MESSAGE)).toBeInTheDocument();
    await scan(app, 'A-01-02');
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(callsTo(fetchMock, RELOCATE)).toHaveLength(1));
    expect(bodyOf(fetchMock)).toEqual({
      fromRackId: origin,
      toRackId: destination,
      overrideCapacity: false,
      all: true,
    });
  });
});
