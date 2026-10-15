import type { MovementPageDto, MovementRowDto } from '@warehouse-manager/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { choose } from '@/features/users/testing';
import { mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { DATE_RANGE_MESSAGE } from './MovementsPage';
import { ok, uuid, warehouseRoutes } from './testing';

const ANA = { id: uuid('99999999'), fullName: 'Ana Almacén' };

const row = (overrides: Partial<MovementRowDto> = {}): MovementRowDto => ({
  id: uuid('77777777'),
  variantId: uuid('eeeeeeee'),
  fromRackId: uuid('bbbbbbbb'),
  toRackId: null,
  quantity: 2,
  type: 'ADJUSTMENT_OUT',
  userId: ANA.id,
  referenceType: null,
  referenceId: null,
  note: 'Tacón roto',
  adjustmentReason: 'DAMAGE',
  capacityOverridden: false,
  // 23:30 del 1 de octubre en Ciudad de México.
  createdAt: '2026-10-02T05:30:00.000Z',
  sku: 'ZAP0101-25-NEG',
  productName: 'Zapato de piel dama',
  variantLabel: '25 · Negro',
  fromLocationCode: 'A-01-01',
  toLocationCode: null,
  user: ANA,
  ...overrides,
});

const PAGE: MovementPageDto = {
  items: [
    row(),
    row({
      type: 'RELOCATE',
      toRackId: uuid('bbbbbbbb'),
      toLocationCode: 'A-01-02',
      note: null,
      adjustmentReason: null,
      createdAt: '2026-10-14T16:00:00.000Z',
    }),
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  timezone: 'America/Mexico_City',
};

/** Responde cualquier consulta del kardex y guarda sus parámetros. */
function start() {
  const base = mockFetch(warehouseRoutes({}));
  const queries: URLSearchParams[] = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/v1/inventory/movements?')) {
      queries.push(new URL(url, 'http://localhost').searchParams);
      return ok(PAGE)();
    }
    return base(input, init);
  }) as unknown as typeof fetch;
  return { last: () => Object.fromEntries(queries.at(-1)!) };
}

describe('MovementsPage (T36)', () => {
  it('muestra fecha (zona de la sucursal), tipo, SKU, de → a, cantidad, usuario, motivo y nota', async () => {
    start();
    renderApp('/warehouse/movements');
    const table = await screen.findByRole('table', { name: 'Movimientos' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    expect(cells).toEqual([
      [
        '1 oct 2026, 23:30',
        'Ajuste de salida',
        'ZAP0101-25-NEGZapato de piel dama · 25 · Negro',
        'A-01-01 → —',
        '2',
        'Ana Almacén',
        'Merma o daño · Tacón roto',
      ],
      [
        expect.stringContaining('14 oct 2026'),
        'Reubicación',
        'ZAP0101-25-NEGZapato de piel dama · 25 · Negro',
        'A-01-01 → A-01-02',
        '2',
        'Ana Almacén',
        '',
      ],
    ]);
  });

  it('los filtros se traducen a MovementListQuery', async () => {
    const api = start();
    const app = renderApp('/warehouse/movements');
    await screen.findByRole('table', { name: 'Movimientos' });
    expect(api.last()).toEqual({ page: '1', pageSize: '20' });

    await app.user.type(screen.getByLabelText('SKU'), 'zap0101');
    await app.user.type(screen.getByLabelText('Ubicación'), 'A-01-01');
    await app.user.click(screen.getByRole('button', { name: 'Ubicación' }));
    await app.user.click(screen.getByRole('button', { name: 'Reubicación' }));
    await choose(app.user, 'Usuario', 'Ana Almacén');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-02' } });

    await waitFor(() =>
      expect(api.last()).toEqual({
        page: '1',
        pageSize: '20',
        sku: 'zap0101',
        locationCode: 'A-01-01',
        types: 'PUTAWAY,RELOCATE',
        userId: ANA.id,
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );
  });

  it('"Hasta" anterior a "Desde" avisa y no consulta', async () => {
    const api = start();
    renderApp('/warehouse/movements');
    await screen.findByRole('table', { name: 'Movimientos' });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } });
    await waitFor(() => expect(api.last().from).toBe('2026-10-05'));
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText(DATE_RANGE_MESSAGE)).toBeInTheDocument();
    expect(api.last().to).toBeUndefined();
  });
});
