import { Prisma } from '../../generated/prisma/client.js';
import { DomainError } from '../errors.js';
import { toApiError } from './errorHandler.js';

// Complementa T11 (integración) con los mapeos que no salen de una ruta de prueba.

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('falla', { code, clientVersion: 'test', meta });

const driver = (originalCode: string, extra: Record<string, unknown> = {}) => ({
  driverAdapterError: { cause: { originalCode, ...extra } },
});

const fastifyError = (code: string | undefined, statusCode: number, message = 'x') =>
  Object.assign(new Error(message), { code, statusCode });

describe('toApiError: mapeos adicionales a T11', () => {
  it.each([
    [
      'FK (P2003) → 409 con la restricción',
      prismaError('P2003', driver('23503', { constraint: { index: 'cart_user_id_fkey' } })),
      409,
      'CONFLICT',
      { constraint: 'cart_user_id_fkey' },
    ],
    ['P2025 → 404', prismaError('P2025'), 404, 'NOT_FOUND', undefined],
    [
      'SQL crudo con violación de unique → 409',
      prismaError(
        'P2010',
        driver('23505', { originalMessage: 'violates unique constraint "x_key"' }),
      ),
      409,
      'CONFLICT',
      { constraint: 'x_key' },
    ],
    [
      'SQL crudo con otro error → 500',
      prismaError('P2010', driver('22012')),
      500,
      'INTERNAL_ERROR',
      undefined,
    ],
    ['conexión rechazada → 503', prismaError('ECONNREFUSED'), 503, 'DB_UNAVAILABLE', undefined],
    ['P1001 → 503', prismaError('P1001'), 503, 'DB_UNAVAILABLE', undefined],
    ['otro código de Prisma → 500', prismaError('P2034'), 500, 'INTERNAL_ERROR', undefined],
    [
      'error de inicialización de Prisma → 503',
      new Prisma.PrismaClientInitializationError('sin BD', 'test'),
      503,
      'DB_UNAVAILABLE',
      undefined,
    ],
  ])('%s', (_name, error, status, code, details) => {
    const { status: actual, body } = toApiError(error);
    expect(actual).toBe(status);
    expect(body.code).toBe(code);
    expect(body.details).toEqual(details);
  });

  it.each([
    ['FST_ERR_CTP_BODY_TOO_LARGE', 413, 'PAYLOAD_TOO_LARGE'],
    ['FST_FILES_LIMIT', 413, 'PAYLOAD_TOO_LARGE'],
    ['FST_ERR_CTP_INVALID_MEDIA_TYPE', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['FST_INVALID_MULTIPART_CONTENT_TYPE', 406, 'VALIDATION_ERROR'],
    ['FST_ERR_CTP_EMPTY_JSON_BODY', 400, 'VALIDATION_ERROR'],
    [undefined, 404, 'NOT_FOUND'],
    [undefined, 413, 'PAYLOAD_TOO_LARGE'],
    [undefined, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [undefined, 405, 'VALIDATION_ERROR'],
    [undefined, 502, 'INTERNAL_ERROR'],
  ])('error de Fastify %s (%i) → %s', (code, statusCode, expected) => {
    expect(toApiError(fastifyError(code, statusCode)).body.code).toBe(expected);
  });

  it('un 4xx genérico conserva su mensaje; uno sin mensaje usa el de por defecto', () => {
    expect(toApiError(fastifyError(undefined, 400, 'Falta el header')).body.message).toBe(
      'Falta el header',
    );
    expect(toApiError(fastifyError(undefined, 400, '')).body.message).toBe(
      'Los datos enviados no son válidos.',
    );
  });

  it('DomainError y errores desconocidos', () => {
    expect(toApiError(new DomainError('RACK_INACTIVE')).status).toBe(409);
    expect(toApiError('no es un Error')).toEqual({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado. Inténtalo de nuevo.' },
    });
  });
});
