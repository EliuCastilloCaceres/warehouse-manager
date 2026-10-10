import { ValidationIssue } from '@warehouse-manager/shared';
import { apiError, callsTo, headersOf, htmlResponse, jsonResponse, mockFetch } from '@/test/http';
import { makeSession } from '@/test/fixtures';
import { apiFetch, configureApiClient, resetApiClient } from './apiClient';
import { ApiError, NetworkError } from './errors';

afterEach(() => resetApiClient());

describe('apiFetch (T1)', () => {
  it('sin token no envía Authorization; con token y sucursal envía Bearer y X-Branch-Id', async () => {
    const fetchMock = mockFetch({ 'GET /api/v1/x': () => jsonResponse(200, { ok: true }) });
    await apiFetch('/api/v1/x');
    expect(headersOf(fetchMock.mock.calls[0]!)).toEqual({});

    configureApiClient({ getAccessToken: () => 'abc', getBranchId: () => 'branch-1' });
    await apiFetch('/api/v1/x');
    const [, init] = fetchMock.mock.calls[1]!;
    expect(headersOf(fetchMock.mock.calls[1]!)).toEqual({
      authorization: 'Bearer abc',
      'x-branch-id': 'branch-1',
    });
    expect((init as RequestInit).credentials).toBe('same-origin');
  });

  it('serializa el body, valida con schema y un 204 devuelve undefined', async () => {
    const fetchMock = mockFetch({
      'POST /api/v1/x': () => jsonResponse(200, { path: 'a', message: 'b' }),
      'DELETE /api/v1/x': () => jsonResponse(204),
      'GET /api/v1/bad': () => jsonResponse(200, { path: 1 }),
    });
    const schema = ValidationIssue;
    await expect(
      apiFetch('/api/v1/x', { method: 'POST', body: { a: 1 }, schema }),
    ).resolves.toEqual({
      path: 'a',
      message: 'b',
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).body).toBe('{"a":1}');
    expect(headersOf(fetchMock.mock.calls[0]!)['content-type']).toBe('application/json');

    await expect(apiFetch('/api/v1/x', { method: 'DELETE' })).resolves.toBeUndefined();
    await expect(apiFetch('/api/v1/bad', { schema })).rejects.toThrow();
  });
});

describe('errores (T2)', () => {
  it.each([
    [
      '409 con ApiErrorDto',
      () => apiError(409, 'STOCK_INSUFFICIENT', 'No hay suficientes', { available: 1 }),
      {
        status: 409,
        code: 'STOCK_INSUFFICIENT',
        message: 'No hay suficientes',
        details: { available: 1 },
      },
    ],
    [
      '500 con HTML',
      () => htmlResponse(500),
      {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Intenta de nuevo.',
        details: undefined,
      },
    ],
  ])('%s → ApiError', async (_name, response, expected) => {
    mockFetch({ 'GET /api/v1/x': response });
    const error = await apiFetch('/api/v1/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect({ ...(error as ApiError), message: (error as ApiError).message }).toMatchObject(
      expected,
    );
  });

  it('fetch rechazado → NetworkError "Sin conexión con el servidor."', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await apiFetch('/api/v1/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toBe('Sin conexión con el servidor.');
  });
});

describe('refresh ante 401 (T3)', () => {
  it('un 401 refresca, guarda el token nuevo y reintenta una vez con él', async () => {
    let token = 'viejo';
    const refreshed = makeSession();
    configureApiClient({
      getAccessToken: () => token,
      onTokenRefreshed: (s) => {
        token = s.accessToken;
      },
    });
    const fetchMock = mockFetch({
      'GET /api/v1/x': [() => apiError(401, 'UNAUTHENTICATED'), () => jsonResponse(200, { ok: 1 })],
      'POST /api/v1/auth/refresh': () => jsonResponse(200, refreshed),
    });

    await expect(apiFetch('/api/v1/x')).resolves.toEqual({ ok: 1 });
    expect(callsTo(fetchMock, 'POST /api/v1/auth/refresh')).toHaveLength(1);
    const retry = callsTo(fetchMock, 'GET /api/v1/x')[1]!;
    expect(headersOf(retry).authorization).toBe(`Bearer ${refreshed.accessToken}`);
  });

  it('si el reintento vuelve a dar 401, falla sin un segundo refresh', async () => {
    const fetchMock = mockFetch({
      'GET /api/v1/x': () => apiError(401, 'UNAUTHENTICATED', 'Sin sesión'),
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
    });
    await expect(apiFetch('/api/v1/x')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(callsTo(fetchMock, 'POST /api/v1/auth/refresh')).toHaveLength(1);
    expect(callsTo(fetchMock, 'GET /api/v1/x')).toHaveLength(2);
  });
});

describe('cambio de contraseña exigido (T7)', () => {
  it('un 403 AUTH_PASSWORD_CHANGE_REQUIRED avisa y falla con ese ApiError', async () => {
    const onPasswordChangeRequired = jest.fn();
    configureApiClient({ onPasswordChangeRequired });
    mockFetch({
      'GET /api/v1/x': () => apiError(403, 'AUTH_PASSWORD_CHANGE_REQUIRED', 'Cambia tu contraseña'),
    });

    await expect(apiFetch('/api/v1/x')).rejects.toMatchObject({
      status: 403,
      code: 'AUTH_PASSWORD_CHANGE_REQUIRED',
    });
    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
  });
});
