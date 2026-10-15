import { screen, within } from '@testing-library/react';
import { mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  locateKey,
  makeContent,
  makeLocate,
  makeLocateVariant,
  makeRow,
  makeTree,
  ok,
  rackKey,
  STAGING_RACK_ID,
  suggestKey,
  treeKey,
  warehouseRoutes,
} from './testing';

const bla = makeLocateVariant('ZAP0102-26-BLA', {
  locations: [
    {
      rackId: STAGING_RACK_ID,
      locationCode: 'STG-01-01',
      zoneName: 'Staging',
      colorHex: null,
      isStaging: true,
      quantity: 2,
      reservedQty: 0,
      available: 2,
    },
  ],
});

describe('StagingPage (T34)', () => {
  it('lista lo pendiente; "Ubicar" abre "producto primero" con esa variante desde staging', async () => {
    mockFetch(
      warehouseRoutes({
        [treeKey()]: ok(makeTree()),
        [rackKey(STAGING_RACK_ID)]: ok(
          makeContent({ id: STAGING_RACK_ID, code: 'STG-01-01', isStaging: true }, [
            makeRow({ variantId: bla.variant.id, sku: 'ZAP0102-26-BLA', quantity: 2 }),
            makeRow({ sku: 'BOL0201-NEG', quantity: 1, reservedQty: 1, available: 0 }),
          ]),
        ),
        [locateKey('ZAP0102-26-BLA')]: ok(makeLocate([bla])),
        [suggestKey(bla.variant.id, 2)]: ok({ fitsAll: true, suggestions: [] }),
      }),
    );
    const app = renderApp('/warehouse/staging');
    const list = await screen.findByRole('list', { name: 'Pendientes de ubicar' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('ZAP0102-26-BLA');
    expect(rows[0]).toHaveTextContent('2 pzas');
    expect(within(rows[1]!).getByRole('button', { name: 'Ubicar BOL0201-NEG' })).toBeDisabled();

    await app.user.click(within(rows[0]!).getByRole('button', { name: 'Ubicar ZAP0102-26-BLA' }));
    expect(app.location()).toBe('/warehouse/putaway?sku=ZAP0102-26-BLA');
    expect(await screen.findByRole('button', { name: 'Desde staging (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('ZAP0102-26-BLA')).toBeInTheDocument();
  });

  it('sin pendientes muestra el estado vacío', async () => {
    mockFetch(
      warehouseRoutes({
        [treeKey()]: ok(makeTree()),
        [rackKey(STAGING_RACK_ID)]: ok(
          makeContent({ id: STAGING_RACK_ID, code: 'STG-01-01', isStaging: true }, []),
        ),
      }),
    );
    renderApp('/warehouse/staging');
    expect(await screen.findByText('No hay productos pendientes de ubicar.')).toBeInTheDocument();
  });
});
