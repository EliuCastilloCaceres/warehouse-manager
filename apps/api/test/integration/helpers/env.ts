import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_ENV = resolve(__dirname, '../../../../../.env');

/** Carga el .env de la raíz (sin sobrescribir variables ya definidas). */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) {
    process.loadEnvFile(ROOT_ENV);
  }
}

/**
 * URL de la BD de pruebas. Lanza un error si no está definida, si no termina en `_test`
 * o si coincide con DATABASE_URL (protege la BD de desarrollo).
 */
export function testDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Falta TEST_DATABASE_URL en .env (ver .env.example).');
  }
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar a una BD cuyo nombre termine en "_test": ${url}`,
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL no puede ser igual a DATABASE_URL.');
  }
  return url;
}
