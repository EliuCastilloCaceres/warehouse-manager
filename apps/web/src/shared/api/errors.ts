import { ApiErrorDto, type ErrorCode } from '@warehouse-manager/shared';

export const GENERIC_ERROR_MESSAGE = 'Ocurrió un error inesperado. Intenta de nuevo.';
export const NETWORK_ERROR_MESSAGE = 'Sin conexión con el servidor.';
export const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Inicia sesión de nuevo.';

/** Respuesta no 2xx de la API, con el `code` estable del error estándar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** La petición no llegó al servidor (sin red, servidor caído, CORS…). */
export class NetworkError extends Error {
  constructor(message = NETWORK_ERROR_MESSAGE) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Convierte una respuesta no 2xx en `ApiError`; si el body no es un `ApiErrorDto`, usa el genérico. */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = ApiErrorDto.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data;
    return new ApiError(response.status, code, message, details);
  }
  return new ApiError(response.status, 'INTERNAL_ERROR', GENERIC_ERROR_MESSAGE);
}

/** Mensaje para mostrar al usuario a partir de cualquier error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return GENERIC_ERROR_MESSAGE;
}
