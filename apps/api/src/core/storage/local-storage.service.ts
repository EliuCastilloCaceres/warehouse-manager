import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageService } from './storage.service.js';

/** Escribe en `UPLOADS_DIR/{key}` y sirve como `/uploads/{key}`. */
export class LocalStorageService implements StorageService {
  constructor(private readonly baseDir: string) {}

  async save(key: string, buffer: Buffer): Promise<{ url: string }> {
    const path = join(this.baseDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return { url: `/uploads/${key}` };
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.baseDir, key), { force: true });
  }
}
