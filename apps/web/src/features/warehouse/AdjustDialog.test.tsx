import { ADJUSTMENT_REASON_LABELS } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { choose } from '@/features/users/testing';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { locateKey, makeLocate, makeLocateVariant, ok, warehouseRoutes } from './testing';

const ADJUST = 'POST /api/v1/inventory/adjust';
const neg = makeLocateVariant('ZAP0101-25-NEG');
const rackA1 = neg.locations[0]!;

function start(
  options: Parameters<typeof warehouseRoutes>[1] = {},
  adjust: () => Response = ok({ movements: [], balances: [] }),
) {
  return mockFetch(
    warehouseRoutes(
      { [locateKey('ZAP0101-25-NEG')]: ok(makeLocate([neg])), [ADJUST]: adjust },
      options,
    ),
  );
}

async function locate(app: ReturnType<typeof renderApp>) {
  await app.user.type(
    await screen.findByLabelText('Escanear producto o ubicación'),
    'ZAP0101-25-NEG{Enter}',
  );
  return screen.findByRole('list', { name: 'Ubicaciones' });
}

async function openDialog(app: ReturnType<typeof renderApp>) {
  const list = await locate(app);
  await app.user.click(within(list).getAllByRole('button', { name: 'Ajustar' })[0]!);
  return screen.findByRole('dialog', { name: 'Ajustar inventario' });
}

describe('AdjustDialog (T35)', () => {
  it('muestra los 6 motivos en español', async () => {
    start();
    const app = renderApp('/warehouse/search');
    const dialog = await openDialog(app);
    expect(dialog).toHaveTextContent('ZAP0101-25-NEG · 25 · Negro en A-01-01');
    await app.user.click(within(dialog).getByLabelText('Motivo'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(Object.values(ADJUSTMENT_REASON_LABELS));
  });

  it('nota y motivo obligatorios; envía AdjustInput con dirección, cantidad, motivo y nota', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/search');
    const dialog = await openDialog(app);
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('La nota es obligatoria')).toBeInTheDocument();
    expect(within(dialog).getByText('El motivo es obligatorio')).toBeInTheDocument();
    expect(callsTo(fetchMock, ADJUST)).toHaveLength(0);

    await app.user.click(within(dialog).getByRole('button', { name: 'Salida' }));
    await app.user.click(within(dialog).getByRole('button', { name: 'Más (Cantidad)' }));
    await choose(app.user, 'Motivo', 'Merma o daño');
    await app.user.type(within(dialog).getByLabelText('Nota'), 'Tacón roto');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(callsTo(fetchMock, ADJUST)).toHaveLength(1));
    expect(JSON.parse(callsTo(fetchMock, ADJUST)[0]![1].body as string)).toEqual({
      variantId: neg.variant.id,
      rackId: rackA1.rackId,
      direction: 'OUT',
      quantity: 2,
      reason: 'DAMAGE',
      note: 'Tacón roto',
      overrideCapacity: false,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Ajustar inventario' })).not.toBeInTheDocument(),
    );
  });

  it('un error de la API se avisa y el diálogo sigue abierto', async () => {
    start({}, () =>
      apiError(409, 'STOCK_INSUFFICIENT', 'No hay suficientes unidades disponibles.'),
    );
    const app = renderApp('/warehouse/search');
    const dialog = await openDialog(app);
    await choose(app.user, 'Motivo', 'Extravío');
    await app.user.type(within(dialog).getByLabelText('Nota'), 'No aparece');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('No hay suficientes unidades disponibles.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ajustar inventario' })).toBeInTheDocument();
  });

  it('sin inventory.adjust la acción "Ajustar" no aparece', async () => {
    start({ role: 'WAREHOUSE_CLERK' });
    const app = renderApp('/warehouse/search');
    await locate(app);
    expect(screen.queryByRole('button', { name: 'Ajustar' })).not.toBeInTheDocument();
  });
});
