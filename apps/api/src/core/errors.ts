import type { ApiErrorDto, ErrorCode } from '@warehouse-manager/shared';

/** Estado HTTP de cada código de error (spec F2 §6.1). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_PASSWORD_INCORRECT: 400,
  BRANCH_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_REFRESH_INVALID: 401,
  AUTH_REFRESH_REUSED: 401,
  FORBIDDEN: 403,
  AUTH_PASSWORD_CHANGE_REQUIRED: 403,
  AUTH_ORIGIN_FORBIDDEN: 403,
  BRANCH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STOCK_INSUFFICIENT: 409,
  RACK_CAPACITY_EXCEEDED: 409,
  RACK_INACTIVE: 409,
  INVENTORY_CROSS_WAREHOUSE: 409,
  INVENTORY_INVALID_OPERATION: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DB_UNAVAILABLE: 503,
};

/** Mensaje por defecto (en español) de cada código; un `DomainError` puede sobrescribirlo. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  AUTH_PASSWORD_INCORRECT: 'La contraseña actual es incorrecta.',
  BRANCH_REQUIRED: 'Indica la sucursal con la que trabajas.',
  UNAUTHENTICATED: 'Tu sesión no es válida o expiró; vuelve a iniciar sesión.',
  AUTH_INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos',
  AUTH_REFRESH_INVALID: 'Tu sesión expiró; vuelve a iniciar sesión.',
  AUTH_REFRESH_REUSED: 'Por seguridad se cerró tu sesión; vuelve a iniciar sesión.',
  FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'Debes cambiar tu contraseña antes de continuar.',
  AUTH_ORIGIN_FORBIDDEN: 'Origen de la solicitud no permitido.',
  BRANCH_FORBIDDEN: 'No tienes acceso a esa sucursal.',
  NOT_FOUND: 'No se encontró el recurso solicitado.',
  CONFLICT: 'La operación entra en conflicto con datos existentes.',
  STOCK_INSUFFICIENT: 'No hay suficientes unidades disponibles.',
  RACK_CAPACITY_EXCEEDED: 'El rack no tiene capacidad suficiente.',
  RACK_INACTIVE: 'El rack está inactivo.',
  INVENTORY_CROSS_WAREHOUSE: 'El origen y el destino deben estar en el mismo almacén.',
  INVENTORY_INVALID_OPERATION: 'La operación de inventario no es válida.',
  PAYLOAD_TOO_LARGE: 'El archivo es demasiado grande.',
  UNSUPPORTED_MEDIA_TYPE: 'Tipo de archivo no permitido.',
  RATE_LIMITED: 'Demasiados intentos; espera un momento e inténtalo de nuevo.',
  INTERNAL_ERROR: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
  DB_UNAVAILABLE: 'La base de datos no está disponible.',
};

/** Error de negocio con código estable; el `errorHandler` lo convierte en `ApiErrorDto`. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, options: { message?: string; details?: unknown } = {}) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details;
  }

  get statusCode(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toDto(): ApiErrorDto {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** `VALIDATION_ERROR` con un solo campo. */
export function validationError(path: string, message: string): DomainError {
  return new DomainError('VALIDATION_ERROR', { details: [{ path, message }] });
}
