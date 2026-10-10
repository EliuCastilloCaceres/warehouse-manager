import { HealthDto } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { DomainError } from '../../core/errors.js';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      config: { access: 'public' },
      schema: {
        tags: ['system'],
        summary: 'Estado de la API y de la base de datos',
        response: { 200: HealthDto },
      },
    },
    async (request) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch (error) {
        request.log.error({ err: error }, 'La base de datos no responde');
        throw new DomainError('DB_UNAVAILABLE');
      }
      return {
        status: 'ok' as const,
        version: app.config.APP_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        database: 'ok' as const,
      };
    },
  );
};
