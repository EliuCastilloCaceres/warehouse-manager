import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// Extensión .ts explícita: el globalSetup corre fuera del registro de módulos de Jest,
// así que no aplica el moduleNameMapper que quita el `.js`.
import { testDatabaseUrl } from './helpers/env.ts';

const API_DIR = resolve(__dirname, '../..');
const PRISMA_CLI = resolve(API_DIR, 'node_modules/prisma/build/index.js');

function prisma(args: string[], url: string, input?: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    input,
    stdio: 'pipe',
  });
}

/**
 * Prepara la BD de pruebas: verifica las guardas, la deja vacía y aplica las migraciones.
 * Nunca toca DATABASE_URL (desarrollo).
 */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();

  try {
    prisma(['db', 'execute', '--stdin'], url, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(
      `No se pudo preparar la BD de pruebas (${url}). ¿Está levantada? Ejecuta "pnpm dev:db" y vuelve a intentar.\n${stderr}`,
      { cause: error },
    );
  }

  prisma(['migrate', 'deploy'], url);
}
