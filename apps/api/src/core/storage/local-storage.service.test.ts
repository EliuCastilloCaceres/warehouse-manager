import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageService } from './local-storage.service.js';
import type { StorageService } from './storage.service.js';

describe('LocalStorageService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wm-storage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('guarda creando carpetas, devuelve /uploads/{key} y borra', async () => {
    const storage: StorageService = new LocalStorageService(dir);
    const { url } = await storage.save('product/a.webp', Buffer.from('abc'), 'image/webp');

    expect(url).toBe('/uploads/product/a.webp');
    expect(readFileSync(join(dir, 'product/a.webp'), 'utf8')).toBe('abc');

    await storage.delete('product/a.webp');
    expect(existsSync(join(dir, 'product/a.webp'))).toBe(false);
    await expect(storage.delete('product/no-existe.webp')).resolves.toBeUndefined();
  });
});
