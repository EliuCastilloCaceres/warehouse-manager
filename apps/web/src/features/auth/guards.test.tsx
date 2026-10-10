import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Providers } from '@/app/providers';
import { makeSession } from '@/test/fixtures';
import { callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { AuthProvider } from './AuthProvider';
import { Can } from './guards';

describe('cambio de contraseña obligatorio (T12)', () => {
  it('/pos redirige a /change-password; ahí "Cerrar sesión" funciona', async () => {
    const fetchMock = mockFetch({
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(200, makeSession({ mustChangePassword: true })),
      'POST /api/v1/auth/logout': () => jsonResponse(204),
    });
    const app = renderApp('/pos');

    await waitFor(() => expect(app.router.state.location.pathname).toBe('/change-password'));
    expect(
      await screen.findByRole('heading', { name: 'Cambia tu contraseña' }),
    ).toBeInTheDocument();

    await app.user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(app.location()).toBe('/login'));
    expect(callsTo(fetchMock, 'POST /api/v1/auth/logout')).toHaveLength(1);
  });
});

function renderWithRole(role: Parameters<typeof makeSession>[0]['role'], ui: React.ReactNode) {
  mockFetch({ 'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ role })) });
  const router = createMemoryRouter([{ path: '/', element: <AuthProvider>{ui}</AuthProvider> }]);
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

describe('<Can> (T15)', () => {
  it('muestra el contenido con el permiso y el fallback sin él; anyOf basta con uno', async () => {
    renderWithRole(
      'SELLER',
      <>
        <Can perm="pos.sell">
          <span>vende</span>
        </Can>
        <Can perm="users.manage" fallback={<span>sin usuarios</span>}>
          <span>administra</span>
        </Can>
        <Can anyOf={['users.manage', 'warehouse.read']}>
          <span>alguno</span>
        </Can>
        <Can anyOf={['users.manage', 'settings.branch']}>
          <span>ninguno</span>
        </Can>
      </>,
    );

    expect(await screen.findByText('vende')).toBeInTheDocument();
    expect(screen.getByText('sin usuarios')).toBeInTheDocument();
    expect(screen.queryByText('administra')).not.toBeInTheDocument();
    expect(screen.getByText('alguno')).toBeInTheDocument();
    expect(screen.queryByText('ninguno')).not.toBeInTheDocument();
  });
});

describe('RequirePermission (T16)', () => {
  it('sin warehouse.read, /warehouse muestra "Sin acceso" en la misma URL', async () => {
    // El Vendedor sí tiene warehouse.read; un usuario sin él: rol con permisos vacíos.
    const session = makeSession({ role: 'SELLER' });
    session.me.permissions = session.me.permissions.filter((p) => p !== 'warehouse.read');
    mockFetch({ 'POST /api/v1/auth/refresh': () => jsonResponse(200, session) });
    const app = renderApp('/warehouse');

    expect(await screen.findByText('No tienes permiso para ver esta sección.')).toBeInTheDocument();
    expect(app.location()).toBe('/warehouse');
  });

  it('con el permiso, el placeholder del módulo', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(200, makeSession({ role: 'WAREHOUSE_CLERK' })),
    });
    renderApp('/warehouse');

    expect(await screen.findByRole('heading', { name: 'Almacén' })).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });
});
