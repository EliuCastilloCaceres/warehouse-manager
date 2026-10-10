import type { ApiErrorDto, ValidationIssue } from '@warehouse-manager/shared';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { Prisma } from '../../generated/prisma/client.js';
import { DomainError, ERROR_HTTP_STATUS, ERROR_MESSAGES } from '../errors.js';

interface MappedError {
  status: number;
  body: ApiErrorDto;
}

const fromCode = (code: keyof typeof ERROR_HTTP_STATUS, details?: unknown, message?: string) =>
  new DomainError(code, { details, message });

/** `/items/0/sku` → `items.0.sku`. */
function toPath(instancePath: string): string {
  return instancePath.replace(/^\//, '').replaceAll('/', '.');
}

/** Nombre de la restricción violada, venga del cliente o de SQL crudo (adaptador pg). */
function constraintOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const cause = (error.meta?.driverAdapterError as { cause?: Record<string, unknown> } | undefined)
    ?.cause;
  const index = (cause?.constraint as { index?: string } | undefined)?.index;
  if (index) return index;
  const message = String(cause?.originalMessage ?? error.message);
  return /constraint "([^"]+)"/.exec(message)?.[1];
}

function driverCode(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const cause = (
    error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined
  )?.cause;
  return cause?.originalCode;
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): DomainError | null {
  const constraint = constraintOf(error);
  switch (error.code) {
    case 'P2002':
      return fromCode('CONFLICT', { target: constraint, constraint });
    case 'P2003':
      return fromCode('CONFLICT', { constraint });
    case 'P2025':
      return fromCode('NOT_FOUND');
    case 'P2010': {
      const code = driverCode(error);
      // 23505 unique · 23503 FK · 23514 CHECK · 23P01 exclusión
      if (code && /^23/.test(code)) return fromCode('CONFLICT', { constraint });
      return null;
    }
    case 'ECONNREFUSED':
    case 'P1001':
      return fromCode('DB_UNAVAILABLE');
    default:
      return null;
  }
}

function mapFastifyError(error: FastifyError): DomainError | null {
  switch (error.code) {
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return fromCode(
        'VALIDATION_ERROR',
        undefined,
        'El cuerpo de la solicitud no es JSON válido.',
      );
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
      return fromCode('PAYLOAD_TOO_LARGE');
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return fromCode('UNSUPPORTED_MEDIA_TYPE');
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return fromCode('VALIDATION_ERROR', [{ path: 'file', message: 'Falta el archivo' }]);
  }
  if (error.statusCode === 404) return fromCode('NOT_FOUND');
  if (error.statusCode === 413) return fromCode('PAYLOAD_TOO_LARGE');
  if (error.statusCode === 415) return fromCode('UNSUPPORTED_MEDIA_TYPE');
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return fromCode(
      'VALIDATION_ERROR',
      undefined,
      error.message || ERROR_MESSAGES.VALIDATION_ERROR,
    );
  }
  return null;
}

/** Convierte cualquier error en `{ status, ApiErrorDto }` (formato estándar de la API). */
export function toApiError(error: unknown): MappedError {
  let domain: DomainError | null = null;
  if (error instanceof DomainError) {
    domain = error;
  } else if (hasZodFastifySchemaValidationErrors(error)) {
    const details: ValidationIssue[] = error.validation.map((issue) => ({
      path: toPath(issue.instancePath),
      message: issue.message ?? 'Valor inválido',
    }));
    domain = fromCode('VALIDATION_ERROR', details);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    domain = mapPrismaError(error);
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    domain = fromCode('DB_UNAVAILABLE');
  } else if (error instanceof Error && 'statusCode' in error) {
    domain = mapFastifyError(error as FastifyError);
  }
  domain ??= fromCode('INTERNAL_ERROR');
  return { status: domain.statusCode, body: domain.toDto() };
}

export const errorHandlerPlugin = fp(
  async (app) => {
    app.setErrorHandler((error, request, reply) => {
      const { status, body } = toApiError(error);
      if (status >= 500) {
        // El detalle (con requestId) solo va al log; el cliente recibe un mensaje genérico.
        request.log.error({ err: error }, 'Error al procesar la solicitud');
      }
      return reply.status(status).send(body);
    });

    app.setNotFoundHandler((_request, reply) => {
      const { status, body } = toApiError(fromCode('NOT_FOUND'));
      return reply.status(status).send(body);
    });
  },
  { name: 'error-handler' },
);
