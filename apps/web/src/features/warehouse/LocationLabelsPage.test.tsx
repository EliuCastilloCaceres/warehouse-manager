import type { LocationLabelDto } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { PRINT_ROOT_ID } from '@/shared/print/PrintLayout';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeTree, ok, treeKey, uuid, WAREHOUSE, warehouseRoutes } from './testing';

const label = (n: number, overrides: Partial<LocationLabelDto> = {}): LocationLabelDto => {
  const code = `A-01-${String(n).padStart(2, '0')}`;
  return {
    rackId: uuid('bbbbbbbb'),
    locationCode: code,
    qrPayload: `LOC:${code}`,
    zoneCode: 'A',
    zoneName: 'Calzado dama',
    containerName: null,
    capacityUnits: 40,
    isStaging: false,
    colorHex: '#2563EB',
    colorName: 'Azul',
    ...overrides,
  };
};

const ELEVEN = Array.from({ length: 11 }, (_, i) => label(i + 1));
const tree = makeTree();
const LABELS = (query: string) => `GET /api/v1/warehouses/${WAREHOUSE.id}/labels?${query}`;

function start() {
  return mockFetch(
    warehouseRoutes({
      [treeKey()]: ok(tree),
      [LABELS('scope=warehouse')]: ok(ELEVEN),
      [LABELS(`scope=zone&ids=${tree.zones[0]!.id}`)]: ok(ELEVEN.slice(0, 2)),
    }),
  );
}

const preview = () => screen.getByTestId('location-labels-preview');

describe('LocationLabelsPage (T38)', () => {
  it('4×6: QR con LOC:, código grande, franja negra con el color, zona y capacidad', async () => {
    start();
    renderApp('/warehouse/labels');
    await waitFor(() =>
      expect(within(preview()).getAllByTestId('location-label')).toHaveLength(11),
    );
    const first = preview().querySelector('[data-label="label-4x6"]')!;
    expect(first.querySelector('[data-code="qr"] svg')).toHaveAttribute(
      'aria-label',
      'LOC:A-01-01',
    );
    expect(first).toHaveTextContent('A-01-01');
    expect(first.querySelector('[data-band="black"]')).toHaveTextContent('Azul');
    expect(first).toHaveTextContent('Calzado dama');
    expect(first).toHaveTextContent('Capacidad 40');
  });

  it('50×25: QR y código, sin franja', async () => {
    start();
    const app = renderApp('/warehouse/labels');
    await app.user.click(await screen.findByRole('button', { name: '50×25 mm' }));
    await waitFor(() =>
      expect(preview().querySelector('[data-label="label-50x25"]')).not.toBeNull(),
    );
    const first = preview().querySelector('[data-label="label-50x25"]')!;
    expect(first.querySelector('[data-code="qr"] svg')).toHaveAttribute(
      'aria-label',
      'LOC:A-01-01',
    );
    expect(first).toHaveTextContent('A-01-01');
    expect(first.querySelector('[data-band]')).toBeNull();
  });

  it.each([
    ['Hoja A4', 'a4'],
    ['Hoja Carta', 'letter'],
  ])('%s: 10 por hoja (11 → 2 hojas) con la banda en su color real', async (button, size) => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    start();
    const app = renderApp('/warehouse/labels');
    await app.user.click(await screen.findByRole('button', { name: button }));
    await waitFor(() => expect(within(preview()).getAllByTestId('location-sheet')).toHaveLength(2));
    const [sheet1, sheet2] = within(preview()).getAllByTestId('location-sheet');
    expect(sheet1!.querySelectorAll('[data-label="sheet"]')).toHaveLength(10);
    expect(sheet2!.querySelectorAll('[data-label="sheet"]')).toHaveLength(1);
    expect(sheet1!.querySelector('[data-band="color"]')).toHaveStyle({
      backgroundColor: '#2563EB',
    });

    await app.user.click(screen.getByRole('button', { name: 'Imprimir' }));
    const root = document.getElementById(PRINT_ROOT_ID)!;
    await waitFor(() => expect(root.querySelector(`[data-print-size="${size}"]`)).not.toBeNull());
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(root.querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });

  it('"Imprimir" en 4×6 monta una página por etiqueta', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    start();
    const app = renderApp('/warehouse/labels');
    await waitFor(() =>
      expect(within(preview()).getAllByTestId('location-label')).toHaveLength(11),
    );
    await app.user.click(screen.getByRole('button', { name: 'Imprimir' }));
    const root = document.getElementById(PRINT_ROOT_ID)!;
    await waitFor(() =>
      expect(root.querySelectorAll('[data-print-size="label-4x6"]')).toHaveLength(11),
    );
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(root.querySelector('[data-print-size]')).toBeNull());
    print.mockRestore();
  });

  it('el alcance de zona pide elegir y consulta con sus ids', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/labels');
    await app.user.click(await screen.findByRole('button', { name: 'Zona' }));
    const list = screen.getByRole('list', { name: 'Elegir ubicaciones' });
    await app.user.click(within(list).getByRole('checkbox', { name: 'A · Calzado dama' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, LABELS(`scope=zone&ids=${tree.zones[0]!.id}`))).toHaveLength(1),
    );
    await waitFor(() => expect(within(preview()).getAllByTestId('location-label')).toHaveLength(2));
  });
});
