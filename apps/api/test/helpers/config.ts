import { type AppConfig, loadConfig } from '../../src/core/config.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';

export const TEST_JWT_SECRET = 'secreto-de-pruebas-de-al-menos-32-caracteres';

/** Config de pruebas: válida, sin logs y con una BD ficticia salvo que se indique otra. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    APP_VERSION: '9.8.7',
    DATABASE_URL: 'postgresql://u:p@localhost:5999/no_existe_test',
    JWT_SECRET: TEST_JWT_SECRET,
    ...overrides,
  });
}

/** Cliente de Prisma simulado para tests unitarios (sin BD). */
export function fakePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PrismaClient;
}
