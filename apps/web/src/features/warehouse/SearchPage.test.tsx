import { screen, waitFor, within } from '@testing-library/react';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { PROMO_SCAN_MESSAGE } from './components';
import { LOCATION_NOT_FOUND, PRODUCT_NOT_FOUND } from './SearchPage';
import {
  byLocationKey,
  locateKey,
  makeContent,
  makeLocate,
  makeLocateVariant,
  makeRow,
  ok,
  rackKey,
  warehouseRoutes,
} from './testing';

const startWarehouse = (...args: Parameters<typeof warehouseRoutes>) =>
  mockFetch(warehouseRoutes(...args));

const neg = makeLocateVariant('ZAP0101-25-NEG', {
  otherBranches: [
    {
      branchId: '22222222-2222-4222-8222-222222222222',
      code: 'S2',
      name: 'Sucursal 2',
      phone: '55 1234 5678',
      available: 2,
    },
  ],
});
const caf = makeLocateVariant('ZAP0101-26-CAF', {
  otherBranches: null,
  stock: { status: 'BAJO', enPiso: false, enStaging: false },
});
const rackA1 = neg.locations[0]!.rackId;

function start(options: Parameters<typeof startWarehouse>[1] = {}) {
  return startWarehouse(
    {
      [locateKey('ZAP0101-25-NEG')]: ok(makeLocate([neg])),
      [locateKey('ZAP0101-26-CAF')]: ok(makeLocate([caf])),
      [locateKey('ZAP0101')]: ok(makeLocate([neg, caf])),
      [locateKey('NOEXISTE')]: () => apiError(404, 'NOT_FOUND', 'No se encontró el producto.'),
      [byLocationKey('A-01-01')]: ok(makeContent({ id: rackA1, code: 'A-01-01' }, [makeRow()])),
      [byLocationKey('Z-01-01')]: () => apiError(404, 'NOT_FOUND', 'No existe.'),
      [rackKey(rackA1)]: ok(makeContent({ id: rackA1, code: 'A-01-01' }, [makeRow()])),
    },
    options,
  );
}

const scan = async (app: ReturnType<typeof renderApp>, code: string) => {
  const field = await screen.findByLabelText('Escanear producto o ubicación');
  await app.user.type(field, `${code}{Enter}`);
};

describe('SearchPage (T30)', () => {
  it('un escaneo de producto llama a locate y lista las ubicaciones con su color', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/search');
    await scan(app, 'zap0101-25-neg');
    const list = await screen.findByRole('list', { name: 'Ubicaciones' });
    expect(callsTo(fetchMock, locateKey('ZAP0101-25-NEG'))).toHaveLength(1);
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('A-01-014 pzas (1 en piso)');
    expect(within(rows[0]!).getByRole('img', { name: 'Color Azul' })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('STG-01-012 pzas (staging)');
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('En piso')).toBeInTheDocument();
  });

  it('con otherBranches muestra "En otras sucursales" con nombre, teléfono y disponibles', async () => {
    start();
    const app = renderApp('/warehouse/search');
    await scan(app, 'ZAP0101-25-NEG');
    const section = await screen.findByRole('region', { name: 'En otras sucursales' });
    expect(section).toHaveTextContent('Sucursal 2 · 55 1234 5678 · 2 disponibles');
  });

  it('con otherBranches: null no muestra la sección', async () => {
    start({ role: 'WAREHOUSE_CLERK' });
    const app = renderApp('/warehouse/search');
    await scan(app, 'ZAP0101-26-CAF');
    await screen.findByRole('list', { name: 'Ubicaciones' });
    expect(screen.queryByText('En otras sucursales')).not.toBeInTheDocument();
    expect(screen.getByText('Bajo')).toBeInTheDocument();
  });

  it('un SKU padre pide elegir la variante', async () => {
    start();
    const app = renderApp('/warehouse/search');
    await scan(app, 'ZAP0101');
    const variants = await screen.findByRole('list', { name: 'Variantes' });
    expect(within(variants).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Ubicaciones' })).not.toBeInTheDocument();
    await app.user.click(within(variants).getByRole('button', { name: /ZAP0101-26-CAF/ }));
    expect(await screen.findByRole('list', { name: 'Ubicaciones' })).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Ver todas las variantes' }));
    expect(screen.getByRole('list', { name: 'Variantes' })).toBeInTheDocument();
  });

  it('un escaneo de promoción muestra su aviso; un código desconocido, "No se encontró"', async () => {
    start();
    const app = renderApp('/warehouse/search');
    await scan(app, 'PROMO:DESC10');
    expect(await screen.findByText(PROMO_SCAN_MESSAGE)).toBeInTheDocument();
    await scan(app, 'NOEXISTE');
    expect(await screen.findByText(PRODUCT_NOT_FOUND)).toBeInTheDocument();
  });

  it('un escaneo de ubicación muestra su contenido', async () => {
    start();
    const app = renderApp('/warehouse/search');
    await scan(app, 'LOC:A-01-01');
    expect(await screen.findByRole('list', { name: 'Contenido de A-01-01' })).toBeInTheDocument();
    await scan(app, 'LOC:Z-01-01');
    expect(await screen.findByText(LOCATION_NOT_FOUND)).toBeInTheDocument();
  });

  it('en modo ajuste, con la variante elegida, escanear una ubicación abre el ajuste ahí', async () => {
    start();
    const app = renderApp('/warehouse/search?mode=adjust');
    expect(await screen.findByRole('heading', { name: 'Ajustar inventario' })).toBeInTheDocument();
    await scan(app, 'ZAP0101-25-NEG');
    await screen.findByRole('list', { name: 'Ubicaciones' });
    await scan(app, 'LOC:A-01-01');
    await waitFor(() =>
      expect(screen.getByText('ZAP0101-25-NEG · 25 · Negro en A-01-01')).toBeInTheDocument(),
    );
  });
});
