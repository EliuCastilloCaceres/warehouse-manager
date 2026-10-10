import { AuthSessionDto } from '@warehouse-manager/shared';
import { apiClientConfig } from './apiClient';
import { ApiError, NetworkError, SESSION_EXPIRED_MESSAGE, toApiError } from './errors';

let inflight: Promise<AuthSessionDto> | null = null;

async function doRefresh(): Promise<AuthSessionDto> {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Sin red: la sesión no se cierra (spec F3 §4).
    throw new NetworkError();
  }
  if (response.status === 401) {
    apiClientConfig().onSessionExpired();
    throw new ApiError(401, 'UNAUTHENTICATED', SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) throw await toApiError(response);

  const session = AuthSessionDto.parse(await response.json());
  apiClientConfig().onTokenRefreshed(session);
  return session;
}

function runRefresh(): Promise<AuthSessionDto> {
  // Entre pestañas los refresh van en fila: la que espera envía la cookie ya rotada.
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks?.request ? locks.request('wm-refresh', doRefresh) : doRefresh();
}

/**
 * Renueva la sesión con la cookie `wm_rt`. En la misma pestaña, todas las llamadas
 * simultáneas comparten una sola promesa (*single-flight*).
 */
export function refreshSession(): Promise<AuthSessionDto> {
  inflight ??= runRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}
