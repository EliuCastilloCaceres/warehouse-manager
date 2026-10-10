import { ApiErrorDto, ErrorCode } from '@warehouse-manager/shared';
import { DomainError, ERROR_HTTP_STATUS, ERROR_MESSAGES, validationError } from './errors.js';

describe('errores (T3)', () => {
  it.each(ErrorCode.options)('%s tiene estado HTTP y mensaje en español', (code) => {
    expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(ERROR_MESSAGES[code]).toEqual(expect.any(String));
    expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
  });

  it('las tablas cubren exactamente los códigos de shared', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ErrorCode.options].sort());
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ErrorCode.options].sort());
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['AUTH_PASSWORD_INCORRECT', 400],
    ['BRANCH_REQUIRED', 400],
    ['UNAUTHENTICATED', 401],
    ['AUTH_REFRESH_REUSED', 401],
    ['FORBIDDEN', 403],
    ['AUTH_ORIGIN_FORBIDDEN', 403],
    ['BRANCH_FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['STOCK_INSUFFICIENT', 409],
    ['INVENTORY_INVALID_OPERATION', 409],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNSUPPORTED_MEDIA_TYPE', 415],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
    ['DB_UNAVAILABLE', 503],
  ] as const)('DomainError(%s) responde %i con un ApiErrorDto válido', (code, status) => {
    const error = new DomainError(code);
    expect(error.statusCode).toBe(status);
    expect(ApiErrorDto.parse(error.toDto())).toEqual({ code, message: ERROR_MESSAGES[code] });
  });

  it('DomainError acepta mensaje y details propios', () => {
    const error = new DomainError('STOCK_INSUFFICIENT', {
      message: 'Solo quedan 2',
      details: { available: 2, requested: 3 },
    });
    expect(ApiErrorDto.parse(error.toDto())).toEqual({
      code: 'STOCK_INSUFFICIENT',
      message: 'Solo quedan 2',
      details: { available: 2, requested: 3 },
    });
    expect(validationError('note', 'Requerida').toDto()).toEqual({
      code: 'VALIDATION_ERROR',
      message: ERROR_MESSAGES.VALIDATION_ERROR,
      details: [{ path: 'note', message: 'Requerida' }],
    });
  });
});
