import { HealthDto } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export interface HealthRoutesOptions {
  version: string;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, opts) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Estado de la API',
        response: { 200: HealthDto },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: opts.version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );
};
