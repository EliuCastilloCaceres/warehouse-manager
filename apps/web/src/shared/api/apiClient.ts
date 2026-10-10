import type { AuthSessionDto } from '@warehouse-manager/shared';
import { ApiError, NetworkError, toApiError } from './errors';
import { refreshSession } from './refresh';

export interface ApiClientConfig {
  getAccessToken: () => string | null;
  getBranchId: () => string | null;
  /** El refresh entregó una sesión nueva (token y `me`). */
  onTokenRefreshed: (session: AuthSessionDto) => void;
  /** El refresh respondió 401: la sesión ya no sirve. */
  onSessionExpired: () => void;
  /** La API exige cambiar la contraseña (403 `AUTH_PASSWORD_CHANGE_REQUIRED`). */
  onPasswordChangeRequired: () => void;
}

const defaults: ApiClientConfig = {
  getAccessToken: () => null,
  getBranchId: () => null,
  onTokenRefreshed: () => {},
  onSessionExpired: () => {},
  onPasswordChangeRequired: () => {},
};

let config: ApiClientConfig = defaults;

/** Conecta el cliente con la sesión y la sucursal (lo hacen `AuthProvider` y `BranchProvider`). */
export function configureApiClient(partial: Partial<ApiClientConfig>): void {
  config = { ...config, ...partial };
}

export function resetApiClient(): void {
  config = defaults;
}

export function apiClientConfig(): ApiClientConfig {
  return config;
}

/** Rutas cuyo 401 nunca dispara un refresh (evita bucles). */
const NO_REFRESH = new Set(['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout']);

export interface ApiFetchOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Esquema Zod (u otro con `parse`) para validar la respuesta. */
  schema?: { parse: (value: unknown) => T };
  signal?: AbortSignal;
}

async function send(path: string, { method = 'GET', body, signal }: ApiFetchOptions<unknown>) {
  const headers: Record<string, string> = {};
  const token = config.getAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const branchId = config.getBranchId();
  if (branchId) headers['x-branch-id'] = branchId;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  try {
    return await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError();
  }
}

async function handle<T>(response: Response, schema: ApiFetchOptions<T>['schema']): Promise<T> {
  if (!response.ok) {
    const error = await toApiError(response);
    if (error.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') config.onPasswordChangeRequired();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json();
  return schema ? schema.parse(data) : (data as T);
}

/**
 * Llama a la API (rutas relativas `/api/v1/...`). Ante un 401 renueva la sesión una sola vez
 * (compartida con las demás peticiones) y reintenta; si vuelve a dar 401, falla.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {},
): Promise<T> {
  const response = await send(path, options);
  if (response.status === 401 && !NO_REFRESH.has(path)) {
    await refreshSession();
    return handle(await send(path, options), options.schema);
  }
  return handle(response, options.schema);
}

export { ApiError, NetworkError };
