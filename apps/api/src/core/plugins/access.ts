import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DomainError } from '../errors.js';
import type { AccessClaims } from '../types.js';

const API_PREFIX = '/api/v1';

/** Si llega `Origin`, su host (`host:puerto`) debe coincidir con el header `Host`. */
export function assertSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = URL.canParse(origin) ? new URL(origin).host : null;
  if (host !== request.headers.host) {
    throw new DomainError('AUTH_ORIGIN_FORBIDDEN');
  }
}

/**
 * Control de acceso por ruta (spec F2 §2):
 * - `onRoute`: toda ruta bajo /api/v1 debe declarar `config.access` (si no, la app no arranca)
 *   y las no públicas se documentan con seguridad Bearer.
 * - `preHandler`: Origin (si la ruta lo pide) → JWT → bloqueo por `mcp` → permiso.
 */
export const accessPlugin = fp(
  async (app) => {
    app.addHook('onRoute', (route) => {
      if (!route.url.startsWith(API_PREFIX)) return;
      const access = route.config?.access;
      if (!access) {
        const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
        throw new Error(`La ruta ${methods} ${route.url} no declara config.access`);
      }
      if (access !== 'public') {
        route.schema = {
          ...route.schema,
          security: route.schema?.security ?? [{ bearerAuth: [] }],
        };
      }
    });

    app.addHook('preHandler', async (request, reply) => {
      const config = request.routeOptions.config;
      if (config.checkOrigin) assertSameOrigin(request);

      const access = config.access;
      if (!access || access === 'public') return;

      let claims: AccessClaims;
      try {
        claims = await request.jwtVerify<AccessClaims>();
      } catch {
        throw new DomainError('UNAUTHENTICATED');
      }
      request.auth = {
        userId: claims.sub,
        role: claims.role,
        permissions: claims.perms,
        branchIds: claims.branchIds,
        defaultBranchId: claims.defaultBranchId,
        mustChangePassword: claims.mcp,
      };
      const log = request.log.child({ userId: claims.sub });
      request.log = log;
      reply.log = log;

      if (claims.mcp && !config.allowDuringPasswordChange) {
        throw new DomainError('AUTH_PASSWORD_CHANGE_REQUIRED');
      }
      if (typeof access === 'object' && !claims.perms.includes(access.permission)) {
        throw new DomainError('FORBIDDEN', { details: { permission: access.permission } });
      }
    });
  },
  { name: 'access', dependencies: ['auth'] },
);
