import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { makeSession } from '@/test/fixtures';
import { apiFetch, configureApiClient, resetApiClient } from './apiClient';
import { ApiError, NetworkError } from './errors';
import { refreshSession } from './refresh';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

function setLocks(value: unknown) {
  Object.defineProperty(navigator, 'locks', { value, configurable: true });
}

afterEach(() => {
  resetApiClient();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else delete (navigator as { locks?: unknown }).locks;
});

describe('refresh único (T4)', () => {
  it('5 peticiones con 401 en paralelo → 1 solo refresh, y las 5 se reintentan', async () => {
    let token = 'viejo';
    configureApiClient({
      getAccessToken: () => token,
      onTokenRefreshed: (s) => {
        token = s.accessToken;
      },
    });
    const fetchMock = mockFetch({
      'GET /api/v1/x': (init) =>
        (init.headers as Record<string, string>).authorization === 'Bearer viejo'
          ? apiError(401, 'UNAUTHENTICATED')
          : jsonResponse(200, { ok: true }),
      'POST /api/v1/auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse(200, makeSession());
      },
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => apiFetch('/api/v1/x')));

    expect(results).toEqual(Array(5).fill({ ok: true }));
    expect(callsTo(fetchMock, 'POST /api/v1/auth/refresh')).toHaveLength(1);
    expect(callsTo(fetchMock, 'GET /api/v1/x')).toHaveLength(10);
  });
});

describe('Web Locks (T5)', () => {
  it('con navigator.locks, el refresh corre dentro de locks.request("wm-refresh")', async () => {
    const request = jest.fn((_name: string, callback: () => Promise<unknown>) => callback());
    setLocks({ request });
    mockFetch({ 'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()) });

    await refreshSession();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe('wm-refresh');
  });

  it('sin navigator.locks, el refresh funciona igual', async () => {
    setLocks(undefined);
    const session = makeSession();
    mockFetch({ 'POST /api/v1/auth/refresh': () => jsonResponse(200, session) });
    await expect(refreshSession()).resolves.toEqual(session);
  });
});

describe('fallos del refresh (T6)', () => {
  it('401 AUTH_REFRESH_REUSED → onSessionExpired una vez y las peticiones fallan con UNAUTHENTICATED', async () => {
    const onSessionExpired = jest.fn();
    configureApiClient({ getAccessToken: () => 'viejo', onSessionExpired });
    mockFetch({
      'GET /api/v1/x': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /api/v1/auth/refresh': () => apiError(401, 'AUTH_REFRESH_REUSED'),
    });

    const errors = await Promise.all(
      [apiFetch('/api/v1/x'), apiFetch('/api/v1/x'), apiFetch('/api/v1/x')].map((p) =>
        p.catch((e: unknown) => e),
      ),
    );
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    for (const error of errors) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    }
  });

  it.each(['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout'])(
    'un 401 de %s nunca dispara refresh',
    async (path) => {
      const fetchMock = mockFetch({
        [`POST ${path}`]: () => apiError(401, 'AUTH_INVALID_CREDENTIALS'),
      });
      await expect(apiFetch(path, { method: 'POST' })).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('un error de red en el refresh no llama a onSessionExpired', async () => {
    const onSessionExpired = jest.fn();
    configureApiClient({ onSessionExpired });
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(refreshSession()).rejects.toBeInstanceOf(NetworkError);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
