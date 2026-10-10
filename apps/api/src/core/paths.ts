import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directorio de `apps/api` (igual desde `src/core` con tsx que desde `dist/core`). */
export const API_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** `UPLOADS_DIR` relativo se resuelve contra `apps/api`. */
export function resolveUploadsDir(uploadsDir: string): string {
  return isAbsolute(uploadsDir) ? uploadsDir : resolve(API_DIR, uploadsDir);
}
