import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carga el .env de la raíz si existe (sin sobrescribir variables ya definidas). */
export function loadRootEnv(apiDir: string): void {
  const rootEnv = resolve(apiDir, '../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
}
