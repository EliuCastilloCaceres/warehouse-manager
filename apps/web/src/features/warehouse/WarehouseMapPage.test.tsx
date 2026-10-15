import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  makeContent,
  makeRack,
  makeRow,
  makeTree,
  ok,
  rackKey,
  warehouseRoutes,
  STAGING_RACK_ID,
  treeKey,
} from './testing';

const startWarehouse = (...args: Parameters<typeof warehouseRoutes>) =>
  mockFetch(warehouseRoutes(...args));

const tree = makeTree();
const rackA1 = tree.zones[0]!.containers[0]!.racks[0]!;
const filtered = makeTree({
  zones: tree.zones.map((zone, i) => ({
    ...zone,
    matchCount: i === 0 ? 1 : 0,
    containers: zone.containers.map((c) => ({
      ...c,
      matchCount: i === 0 ? 1 : 0,
      racks: c.racks.map((r) => ({ ...r, matchCount: r.id === rackA1.id ? 1 : 0 })),
    })),
  })),
});

const NBSP = String.fromCharCode(0xa0);
const meter = (name: string) => screen.getByRole('meter', { name });

function start() {
  return startWarehouse({
    [treeKey()]: ok(tree),
    [treeKey({ status: 'BAJO' })]: ok(filtered),
    [rackKey(rackA1.id)]: ok(
      makeContent({ id: rackA1.id, code: 'A-01-01', colorHex: '#2563EB' }, [
        makeRow({ sku: 'ZAP0101-25-NEG', quantity: 9, reservedQty: 2 }),
        makeRow({
          sku: 'ZAP0101-25-CAF',
          quantity: 1,
          stock: { status: 'BAJO', enPiso: false, enStaging: false },
        }),
      ]),
    ),
    [rackKey(rackA1.id, 'BAJO')]: ok(
      makeContent({ id: rackA1.id, code: 'A-01-01' }, [
        makeRow({
          sku: 'ZAP0101-25-CAF',
          quantity: 1,
          stock: { status: 'BAJO', enPiso: false, enStaging: false },
        }),
      ]),
    ),
    [rackKey(STAGING_RACK_ID)]: ok(
      makeContent({ id: STAGING_RACK_ID, code: 'STG-01-01', isStaging: true }, [
        makeRow({ quantity: 12, stock: { status: 'DISPONIBLE', enPiso: false, enStaging: true } }),
      ]),
    ),
  });
}

describe('WarehouseMapPage (T29)', () => {
  it('muestra el árbol con CapacityBar por nivel, los totales y staging sin límite', async () => {
    start();
    renderApp('/warehouse/map');
    expect(await screen.findByRole('heading', { name: 'Almacén principal' })).toBeInTheDocument();
    expect(meter('Ocupación total')).toHaveAttribute('aria-valuetext', `33 / 120 (28${NBSP}%)`);
    expect(meter('Ocupación de staging')).toHaveAttribute('aria-valuetext', 'Sin límite');
    expect(screen.getByText('Staging: 12 pzas')).toBeInTheDocument();
    expect(meter('Ocupación de A · Calzado dama')).toHaveAttribute(
      'aria-valuetext',
      `13 / 80 (16${NBSP}%)`,
    );
    expect(meter('Ocupación de A-01')).toHaveAttribute('aria-valuetext', `13 / 80 (16${NBSP}%)`);
    expect(meter('Ocupación de A-01-01')).toHaveAttribute('aria-valuetext', `10 / 40 (25${NBSP}%)`);
    expect(meter('Ocupación de B-01-01')).toHaveAttribute('data-status', 'ok');
    expect(screen.getAllByRole('img', { name: 'Color Azul' }).length).toBeGreaterThan(0);
  });

  it('tocar un rack abre su contenido con el estado de cada variante', async () => {
    start();
    const app = renderApp('/warehouse/map');
    await app.user.click(await screen.findByRole('button', { name: 'Rack A-01-01' }));
    const list = await screen.findByRole('list', { name: 'Contenido de A-01-01' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ZAP0101-25-NEG');
    expect(items[0]).toHaveTextContent('9 pzas (2 en piso)');
    expect(items[0]).toHaveTextContent('Disponible');
    expect(items[1]).toHaveTextContent('Bajo');
  });

  it('un filtro agrega status a la consulta y muestra matchCount', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/map');
    await app.user.click(await screen.findByRole('button', { name: 'Bajo' }));
    await waitFor(() => expect(callsTo(fetchMock, treeKey({ status: 'BAJO' }))).toHaveLength(1));
    expect(await screen.findAllByText('1 coincide')).toHaveLength(3); // zona, contenedor y rack
    expect(screen.getByRole('button', { name: 'Bajo' })).toHaveAttribute('aria-pressed', 'true');

    await app.user.click(screen.getByRole('button', { name: 'Rack A-01-01' }));
    const list = await screen.findByRole('list', { name: 'Contenido de A-01-01' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(callsTo(fetchMock, rackKey(rackA1.id, 'BAJO'))).toHaveLength(1);
  });

  it('staging abre su contenido', async () => {
    start();
    const app = renderApp('/warehouse/map');
    await app.user.click(await screen.findByRole('button', { name: 'Staging STG-01-01' }));
    const list = await screen.findByRole('list', { name: 'Contenido de STG-01-01' });
    expect(list).toHaveTextContent('En staging');
  });

  it('un rack inactivo se ve atenuado', async () => {
    const withInactive = makeTree();
    withInactive.zones[1]!.containers[0]!.racks.push(makeRack('B-01-02', 0, { isActive: false }));
    startWarehouse({ [treeKey()]: ok(withInactive) });
    renderApp('/warehouse/map');
    expect(await screen.findByRole('button', { name: 'Rack B-01-02' })).toHaveClass('opacity-60');
  });
});

describe('RackContent: paginación, ajuste y errores', () => {
  const rows = Array.from({ length: 50 }, (_, i) =>
    makeRow({ sku: `SKU-${String(i).padStart(3, '0')}` }),
  );
  const page1 = { ...makeContent({ id: rackA1.id, code: 'A-01-01' }, rows), total: 51 };
  const page2 = {
    ...makeContent({ id: rackA1.id, code: 'A-01-01' }, [makeRow({ sku: 'SKU-050' })]),
    page: 2,
    total: 51,
  };

  it('pagina el contenido y "Ajustar" abre el diálogo del rack', async () => {
    const fetchMock = startWarehouse({
      [treeKey()]: ok(tree),
      [rackKey(rackA1.id)]: ok(page1),
      [`GET /api/v1/racks/${rackA1.id}?page=2&pageSize=50`]: ok(page2),
    });
    const app = renderApp('/warehouse/map');
    await app.user.click(await screen.findByRole('button', { name: 'Rack A-01-01' }));
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await app.user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('SKU-050')).toBeInTheDocument();
    expect(callsTo(fetchMock, `GET /api/v1/racks/${rackA1.id}?page=2&pageSize=50`)).toHaveLength(1);

    await app.user.click(screen.getByRole('button', { name: 'Ajustar' }));
    expect(await screen.findByRole('dialog', { name: 'Ajustar inventario' })).toHaveTextContent(
      'SKU-050 · 25 · Negro en A-01-01',
    );
  });

  it('un error al cargar el contenido ofrece reintentar', async () => {
    startWarehouse({
      [treeKey()]: ok(tree),
      [rackKey(rackA1.id)]: [
        () =>
          ({
            ok: false,
            status: 500,
            json: async () => ({ code: 'INTERNAL_ERROR', message: 'Falló' }),
          }) as unknown as Response,
        ok(makeContent({ id: rackA1.id, code: 'A-01-01' }, [])),
      ],
    });
    const app = renderApp('/warehouse/map');
    await app.user.click(await screen.findByRole('button', { name: 'Rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay productos aquí.')).toBeInTheDocument();
  });
});
