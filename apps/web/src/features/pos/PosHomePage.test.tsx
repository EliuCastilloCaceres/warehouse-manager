import { screen, waitFor, within } from '@testing-library/react';
import { callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeSessionDto, ok, posRoutes, saveDeviceRegister, sessionKey } from './testing';

describe('PosHomePage (T23)', () => {
  it('en /pos muestra [Atender] y [Cobrar]; sin caja guardada no hay "Mi caja"', async () => {
    mockFetch(posRoutes({}));
    renderApp('/pos');
    const nav = await screen.findByRole('navigation', { name: 'Punto de venta' });
    expect(within(nav).getByRole('link', { name: 'Atender' })).toHaveAttribute('href', '/pos/sell');
    expect(within(nav).getByRole('link', { name: 'Cobrar' })).toHaveAttribute('href', '/pos/carts');
    expect(screen.queryByRole('region', { name: 'Mi caja' })).not.toBeInTheDocument();
  });

  it('"Mi caja" aparece si el dispositivo tiene una caja abierta guardada', async () => {
    saveDeviceRegister();
    mockFetch(posRoutes({ [sessionKey()]: ok(makeSessionDto()) }));
    renderApp('/pos');
    const mine = await screen.findByRole('region', { name: 'Mi caja' });
    expect(mine).toHaveTextContent('Mi caja · C1 · Caja 1');
    expect(within(mine).getByRole('link', { name: 'Historial' })).toHaveAttribute(
      'href',
      '/pos/sales',
    );
    expect(within(mine).getByRole('link', { name: 'Corte' })).toHaveAttribute('href', '/pos/close');
  });

  it('con la sesión guardada ya cerrada no muestra "Mi caja"', async () => {
    saveDeviceRegister();
    const closed = makeSessionDto({ status: 'CLOSED' });
    const fetchMock = mockFetch(posRoutes({ [sessionKey()]: ok(closed) }));
    const app = renderApp('/pos');
    await screen.findByRole('navigation', { name: 'Punto de venta' });
    await waitFor(() => expect(callsTo(fetchMock, sessionKey())).toHaveLength(1));
    await waitFor(() =>
      expect(app.queryClient.getQueryData(['pos-session', closed.id])).toEqual(closed),
    );
    expect(screen.queryByRole('region', { name: 'Mi caja' })).not.toBeInTheDocument();
  });

  it('sin pos.sell el módulo no aparece en el menú y /pos no se puede ver', async () => {
    mockFetch(posRoutes({}, { role: 'WAREHOUSE_CLERK' }));
    renderApp('/pos');
    expect(await screen.findByText('No tienes permiso para ver esta sección.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Módulos' });
    expect(within(nav).queryByRole('link', { name: 'POS' })).not.toBeInTheDocument();
  });
});
