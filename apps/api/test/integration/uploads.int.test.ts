import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMAGE_UPLOAD_MAX_BYTES, ImageUploadDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { multipartFile } from './helpers/multipart.js';
import { resetWithSeed } from './helpers/seed.js';
import { createUser } from './helpers/users.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } });

/** Archivos escritos bajo `dir` (recursivo). */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('subida de imágenes', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let uploadsDir: string;
  let managerToken: string;
  let sellerToken: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'gerente', role: 'MANAGER' });
    await createUser(prisma, { username: 'vendedor', role: 'SELLER' });
    uploadsDir = mkdtempSync(join(tmpdir(), 'wm-uploads-'));
    app = await createTestApp(prisma, { config: { UPLOADS_DIR: uploadsDir } });
    managerToken = (await login(app, 'gerente')).accessToken;
    sellerToken = (await login(app, 'vendedor')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  // Se lee a un buffer: sharp con una ruta deja el archivo abierto en Windows.
  const metadataOf = (url: string) =>
    sharp(readFileSync(join(uploadsDir, url.replace('/uploads/', '')))).metadata();

  const upload = (url: string, token: string, file: ReturnType<typeof multipartFile>) =>
    app.inject({
      method: 'POST',
      url,
      payload: file.payload,
      headers: { ...file.headers, ...bearer(token) },
    });

  describe('T27', () => {
    it('JPEG 3000×2000 → WebP 1600×1067 y miniatura de lado 400, servidos por el static', async () => {
      const jpeg = await solid(3000, 2000).jpeg().toBuffer();
      const res = await upload('/api/v1/uploads/product-images', managerToken, multipartFile(jpeg));

      expect(res.statusCode).toBe(201);
      const body = ImageUploadDto.parse(res.json());
      expect(body).toMatchObject({ width: 1600, height: 1067 });
      expect(body.url).toMatch(/^\/uploads\/product\/[0-9a-f-]{36}\.webp$/);
      expect(body.thumbUrl).toBe(body.url.replace('.webp', '.thumb.webp'));

      const mainMeta = await metadataOf(body.url);
      expect(mainMeta).toMatchObject({ format: 'webp', width: 1600, height: 1067 });
      const thumbMeta = await metadataOf(body.thumbUrl);
      expect(thumbMeta.format).toBe('webp');
      expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBe(400);

      const served = await app.inject({ method: 'GET', url: body.url });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/webp');
    });

    it.each([
      ['PNG', () => solid(800, 600).png().toBuffer(), 'foto.png', 'image/png'],
      ['WebP', () => solid(800, 600).webp().toBuffer(), 'foto.webp', 'image/webp'],
    ])('%s también se acepta', async (_name, make, filename, contentType) => {
      const file = multipartFile(await make(), { filename, contentType });
      const res = await upload('/api/v1/uploads/product-images', managerToken, file);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ width: 800, height: 600 });
    });

    it('branch-images guarda en branch/', async () => {
      const jpeg = await solid(500, 500).jpeg().toBuffer();
      const res = await upload('/api/v1/uploads/branch-images', managerToken, multipartFile(jpeg));
      expect(res.statusCode).toBe(201);
      expect(res.json().url).toMatch(/^\/uploads\/branch\//);
    });
  });

  describe('T28', () => {
    let filesBefore: string[];

    beforeEach(() => {
      filesBefore = filesIn(uploadsDir);
    });

    afterEach(() => {
      // Ningún caso de error deja archivos escritos.
      expect(filesIn(uploadsDir)).toEqual(filesBefore);
    });

    it('sin products.manage → 403; branch-images sin settings.branch → 403', async () => {
      const jpeg = await solid(100, 100).jpeg().toBuffer();
      for (const url of ['/api/v1/uploads/product-images', '/api/v1/uploads/branch-images']) {
        const res = await upload(url, sellerToken, multipartFile(jpeg));
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      }
    });

    it.each([
      ['texto con extensión .jpg', async () => Buffer.from('esto no es una imagen'), 'foto.jpg'],
      ['GIF', async () => solid(50, 50).gif().toBuffer(), 'animado.gif'],
    ])('%s → 415', async (_name, make, filename) => {
      const res = await upload(
        '/api/v1/uploads/product-images',
        managerToken,
        multipartFile(await make(), { filename }),
      );
      expect(res.statusCode).toBe(415);
      expect(res.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('10 MiB + 1 byte → 413 PAYLOAD_TOO_LARGE', async () => {
      const big = Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1, 1);
      const res = await upload('/api/v1/uploads/product-images', managerToken, multipartFile(big));
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('sin archivo → 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/product-images',
        headers: bearer(managerToken),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'file' }] });

      const wrongField = await upload(
        '/api/v1/uploads/product-images',
        managerToken,
        multipartFile(await solid(10, 10).jpeg().toBuffer(), { field: 'imagen' }),
      );
      expect(wrongField.statusCode).toBe(400);
    });
  });
});
