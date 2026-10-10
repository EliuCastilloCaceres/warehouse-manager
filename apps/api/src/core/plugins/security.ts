import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { DomainError } from '../errors.js';

/**
 * Helmet (sin CSP: la API solo sirve JSON y Swagger UI), cookies y rate limit por ruta.
 * El rate limit global queda para F10.
 */
export const securityPlugin = fp(
  async (app) => {
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cookie);
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) =>
        new DomainError('RATE_LIMITED', {
          details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) },
        }),
    });
  },
  { name: 'security' },
);
