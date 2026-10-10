import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyServerOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Respeta un `x-request-id` entrante si es un UUID; si no, genera uno. */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && UUID.test(incoming) ? incoming : randomUUID();
}

export type LoggerOption = boolean | Exclude<FastifyServerOptions['logger'], boolean | undefined>;

/** Opciones del logger (pino): headers en el log, con credenciales ocultas. */
export function loggerOptions(
  config: AppConfig,
  logger?: LoggerOption,
): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  const base = {
    level: config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[oculto]',
    },
    serializers: {
      req: (request: { method: string; url: string; headers: unknown; ip?: string }) => ({
        method: request.method,
        url: request.url,
        headers: request.headers,
        remoteAddress: request.ip,
      }),
      res: (reply: { statusCode: number; getHeaders?: () => unknown }) => ({
        statusCode: reply.statusCode,
        headers: reply.getHeaders?.(),
      }),
    },
  };
  if (typeof logger === 'object') return { ...base, ...logger };
  if (config.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return base;
}

/** Devuelve el id de la petición en el header `x-request-id`. */
export const requestContextPlugin = fp(
  async (app) => {
    app.addHook('onRequest', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  },
  { name: 'request-context' },
);
