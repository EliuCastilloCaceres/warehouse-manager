import type { FastifyInstance } from 'fastify';
import { type AppDeps, buildApp } from '../../../src/app.js';
import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { testConfig } from '../../helpers/config.js';
import { testDatabaseUrl } from './env.js';

export interface TestAppOptions extends Omit<AppDeps, 'prisma'> {
  config?: Record<string, string>;
}

/** App completa contra la BD de pruebas, lista para `inject`. Sin logs salvo que se pidan. */
export async function createTestApp(
  prisma: PrismaClient,
  { config, logger = false, ...deps }: TestAppOptions = {},
): Promise<FastifyInstance> {
  const app = await buildApp(testConfig({ DATABASE_URL: testDatabaseUrl(), ...config }), {
    prisma,
    logger,
    ...deps,
  });
  await app.ready();
  return app;
}
