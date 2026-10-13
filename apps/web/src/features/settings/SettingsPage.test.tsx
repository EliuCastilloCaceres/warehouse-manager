import type { PermissionCode } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { BRANCH_URL, makeBranch, makeRegister, sessionWith } from './testing';

function start(permissions: PermissionCode[]) {
  mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, sessionWith(permissions)),
    [`GET ${BRANCH_URL}`]: () => jsonResponse(200, makeBranch()),
    'GET /api/v1/cash-registers': () => jsonResponse(200, [makeRegister('C1', 'Caja 1', 1)]),
  });
}

const tabs = async () =>
  within(await screen.findByRole('navigation', { name: 'Secciones de Ajustes' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('SettingsPage (T16)', () => {
  it.each([
    [['settings.branch'], ['Sucursal'], '/settings/branch'],
    [['settings.registers'], ['Cajas'], '/settings/registers'],
    [['settings.branch', 'settings.registers'], ['Sucursal', 'Cajas'], '/settings/branch'],
  ] as [PermissionCode[], string[], string][])(
    'con %j ve %j y /settings lleva a %s',
    async (permissions, visible, target) => {
      start(permissions);
      const app = renderApp('/settings');
      expect(await tabs()).toEqual(visible);
      await waitFor(() => expect(app.location()).toBe(target));
    },
  );

  it('una pestaña sin su permiso muestra "Sin acceso"', async () => {
    start(['settings.branch']);
    renderApp('/settings/registers');
    expect(await screen.findByText('No tienes permiso para ver esta sección.')).toBeInTheDocument();
  });

  it('sin ningún permiso de Ajustes tampoco entra', async () => {
    start([]);
    renderApp('/settings');
    expect(await screen.findByText('No tienes permiso para ver esta sección.')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Secciones de Ajustes' }),
    ).not.toBeInTheDocument();
  });
});
