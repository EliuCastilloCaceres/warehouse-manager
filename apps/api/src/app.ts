import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppConfig } from './core/config.js';
import { registerSwagger } from './core/swagger.js';
import { healthRoutes } from './modules/health/health.routes.js';

export interface BuildAppOptions {
  /** `false` desactiva los logs (tests). */
  logger?: boolean;
}

function loggerOptions(config: AppConfig, opts: BuildAppOptions): FastifyServerOptions['logger'] {
  if (opts.logger === false) return false;
  if (config.NODE_ENV === 'development') {
    return {
      level: config.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: config.LOG_LEVEL };
}

export async function buildApp(
  config: AppConfig,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config, opts) });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (config.NODE_ENV !== 'production') {
    await registerSwagger(app, config.APP_VERSION);
  }

  await app.register(healthRoutes, { prefix: '/api/v1', version: config.APP_VERSION });

  return app;
}
