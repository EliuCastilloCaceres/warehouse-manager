import { screen, waitFor } from '@testing-library/react';
import { BRANCH_S1, BRANCH_S2, makeSession } from '@/test/fixtures';
import { callsTo, headersOf, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { apiFetch } from '@/shared/api/apiClient';
import { branchStorageKey } from './BranchProvider';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const health = () =>
  jsonResponse(200, {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    timestamp: '2026-10-01T18:00:00.000Z',
    database: 'ok',
  });

describe('sucursal (T19)', () => {
  it.each([
    {
      name: 'elección guardada válida → se usa',
      branches: [BRANCH_S1, BRANCH_S2],
      stored: BRANCH_S2.id,
      check: async (app: ReturnType<typeof renderApp>) => {
        expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
        expect(app.location()).toBe('/');
        expect(screen.getByTitle(BRANCH_S2.name)).toHaveTextContent('S2');
      },
    },
    {
      name: 'guardada que ya no está → /select-branch con la predeterminada preseleccionada',
      branches: [BRANCH_S1, BRANCH_S2],
      stored: '99999999-9999-4999-8999-999999999999',
      check: async (app: ReturnType<typeof renderApp>) => {
        await waitFor(() => expect(app.router.state.location.pathname).toBe('/select-branch'));
        expect(await screen.findByRole('radio', { name: /S1 · Sucursal Centro/ })).toBeChecked();
        expect(localStorage.getItem(branchStorageKey(USER_ID))).toBeNull();
      },
    },
    {
      name: 'una sola sucursal → automática y sin selector',
      branches: [BRANCH_S1],
      stored: null,
      check: async (app: ReturnType<typeof renderApp>) => {
        expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
        expect(app.location()).toBe('/');
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      },
    },
    {
      name: 'ninguna → "Tu usuario no tiene sucursales asignadas"',
      branches: [],
      stored: null,
      check: async () => {
        expect(
          await screen.findByText(/Tu usuario no tiene sucursales asignadas/),
        ).toBeInTheDocument();
      },
    },
  ])('$name', async ({ branches, stored, check }) => {
    if (stored) localStorage.setItem(branchStorageKey(USER_ID), stored);
    mockFetch({
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ branches })),
      'GET /api/v1/health': health,
    });
    await check(renderApp('/'));
  });

  it('elegir guarda wm.branch.<userId>', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(200, makeSession({ branches: [BRANCH_S1, BRANCH_S2] })),
      'GET /api/v1/health': health,
    });
    const app = renderApp('/');
    await app.user.click(await screen.findByRole('radio', { name: /S2 · Sucursal Norte/ }));
    await app.user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(localStorage.getItem(branchStorageKey(USER_ID))).toBe(BRANCH_S2.id);
  });
});

describe('cambio de sucursal (T20)', () => {
  it('cambia el X-Branch-Id de la siguiente petición y vacía la caché', async () => {
    localStorage.setItem(branchStorageKey(USER_ID), BRANCH_S1.id);
    const fetchMock = mockFetch({
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(200, makeSession({ branches: [BRANCH_S1, BRANCH_S2] })),
      'GET /api/v1/health': health,
    });
    const app = renderApp('/');
    await screen.findByRole('heading', { name: 'Inicio' });
    await apiFetch('/api/v1/health');
    expect(headersOf(callsTo(fetchMock, 'GET /api/v1/health').at(-1)!)['x-branch-id']).toBe(
      BRANCH_S1.id,
    );
    app.queryClient.setQueryData(['cache-de-s1'], 'datos');

    await app.user.click(screen.getByRole('button', { name: 'Menú de usuario' }));
    await app.user.click(await screen.findByRole('button', { name: 'Cambiar sucursal' }));
    await app.user.click(await screen.findByRole('radio', { name: /S2 · Sucursal Norte/ }));
    await app.user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { name: 'Inicio' });

    expect(app.queryClient.getQueryData(['cache-de-s1'])).toBeUndefined();
    await apiFetch('/api/v1/health');
    expect(headersOf(callsTo(fetchMock, 'GET /api/v1/health').at(-1)!)['x-branch-id']).toBe(
      BRANCH_S2.id,
    );
  });
});
