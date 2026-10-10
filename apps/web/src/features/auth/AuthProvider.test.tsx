import { screen, waitFor } from '@testing-library/react';
import { FakeBroadcastChannel } from '@/test/broadcast';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { sessionStore } from './sessionStore';

const health = () =>
  jsonResponse(200, {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    timestamp: '2026-10-01T18:00:00.000Z',
    database: 'ok',
  });

describe('arranque de la sesión (T8)', () => {
  it('muestra "Cargando…" y con refresh 200 queda la sesión del me recibido', async () => {
    const session = makeSession();
    let resolve: (r: Response) => void = () => {};
    mockFetch({
      'POST /api/v1/auth/refresh': () => new Promise<Response>((r) => (resolve = r)),
      'GET /api/v1/health': health,
    });
    renderApp('/');

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    resolve(jsonResponse(200, session));

    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(sessionStore.get()).toEqual({ accessToken: session.accessToken, me: session.me });
  });

  it('refresh 401 → anónimo, y /pos redirige a /login?next=%2Fpos', async () => {
    mockFetch({ 'POST /api/v1/auth/refresh': () => apiError(401, 'AUTH_REFRESH_INVALID') });
    const app = renderApp('/pos');

    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(app.location()).toBe('/login?next=%2Fpos');
    expect(sessionStore.get()).toBeNull();
  });

  it('error de red → "No se pudo conectar con el servidor" y Reintentar vuelve a refrescar', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(apiError(401, 'AUTH_REFRESH_INVALID'));
    globalThis.fetch = fetchMock;
    const app = renderApp('/');

    expect(await screen.findByText('No se pudo conectar con el servidor')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('logout (T13)', () => {
  it.each([
    ['respuesta 204', () => jsonResponse(204)],
    ['error de red', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])(
    'con %s cierra la sesión local, vacía la caché, avisa a las pestañas y va a /login',
    async (_name, logout) => {
      const fetchMock = mockFetch({
        'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
        'GET /api/v1/health': health,
        'POST /api/v1/auth/logout': logout as never,
      });
      const app = renderApp('/');
      await screen.findByRole('heading', { name: 'Inicio' });
      app.queryClient.setQueryData(['algo'], 1);

      await app.user.click(screen.getByRole('button', { name: 'Menú de usuario' }));
      await app.user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

      await waitFor(() => expect(app.location()).toBe('/login'));
      expect(callsTo(fetchMock, 'POST /api/v1/auth/logout')).toHaveLength(1);
      expect(sessionStore.get()).toBeNull();
      expect(app.queryClient.getQueryData(['algo'])).toBeUndefined();
      expect(FakeBroadcastChannel.posted).toEqual([{ name: 'wm-auth', data: { type: 'logout' } }]);
    },
  );
});

describe('logout desde otra pestaña (T14)', () => {
  it('al recibir { type: "logout" } limpia la sesión y navega a /login', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
      'GET /api/v1/health': health,
    });
    const app = renderApp('/');
    await screen.findByRole('heading', { name: 'Inicio' });

    FakeBroadcastChannel.deliver('wm-auth', { type: 'logout' });

    await waitFor(() => expect(app.location()).toBe('/login'));
    expect(sessionStore.get()).toBeNull();
  });
});
