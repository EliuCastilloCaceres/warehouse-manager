import type { ProductDetailDto, ProductImageDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { multipartFile } from './helpers/multipart.js';
import { imageUrls, variableInput } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

describe('imágenes de producto (T16)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let product: ProductDetailDto;
  let other: ProductDetailDto;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    token = (await loginSeeded(app, prisma, 'admin')).accessToken;
    const create = async (sku: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/products',
          headers: bearer(token),
          payload: variableInput(sku, ['25', '26']),
        })
      ).json() as ProductDetailDto;
    product = await create('IMG0101');
    other = await create('IMG0102');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/products/${product.id}/images${path}`,
      headers: bearer(token),
      ...(payload ? { payload: payload as Record<string, unknown> } : {}),
    });
  const images = () =>
    prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: 'asc' },
    });

  it('agrega una imagen subida con /uploads/product-images al final del orden', async () => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#2563eb' },
    })
      .png()
      .toBuffer();
    const form = multipartFile(png, { filename: 'foto.png', contentType: 'image/png' });
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/product-images',
      headers: { ...bearer(token), ...form.headers },
      payload: form.payload,
    });
    expect(upload.statusCode).toBe(201);
    const { url, thumbUrl } = upload.json() as { url: string; thumbUrl: string };

    const first = await call('POST', '', imageUrls(1));
    expect(first.statusCode).toBe(201);
    const res = await call('POST', '', { url, thumbUrl });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ url, thumbUrl, sortOrder: 1, variantId: null });
  });

  it.each([
    [
      'una url de sucursal',
      {
        url: '/uploads/branch/00000000-0000-4000-8000-000000000001.webp',
        thumbUrl: imageUrls(1).thumbUrl,
      },
      'url',
    ],
    [
      'un thumbUrl de otro uuid',
      { url: imageUrls(5).url, thumbUrl: imageUrls(6).thumbUrl },
      'thumbUrl',
    ],
    ['una variante de otro producto', { ...imageUrls(5), variantId: 'OTHER' }, 'variantId'],
  ])('%s → 400', async (_caso, payload, path) => {
    const body = { ...payload } as Record<string, unknown>;
    if (body.variantId === 'OTHER') body.variantId = other.variants[0]!.id;
    const res = await call('POST', '', body);
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual([expect.objectContaining({ path })]);
  });

  it('la 11.ª imagen → 409 PRODUCT_IMAGE_LIMIT', async () => {
    for (let n = 10; (await images()).length < 10; n++) {
      expect((await call('POST', '', imageUrls(n))).statusCode).toBe(201);
    }
    const res = await call('POST', '', imageUrls(99));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PRODUCT_IMAGE_LIMIT');
  });

  it('reordena con el conjunto exacto; uno incompleto o repetido → 400', async () => {
    const ids = (await images()).map((i) => i.id);
    const reversed = [...ids].reverse();
    const res = await call('PUT', '/order', { imageIds: reversed });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ProductImageDto[]).map((i) => i.id)).toEqual(reversed);
    expect((await images()).map((i) => i.id)).toEqual(reversed);

    for (const imageIds of [reversed.slice(1), [...reversed.slice(1), reversed[1]!]]) {
      const bad = await call('PUT', '/order', { imageIds });
      expect(bad.statusCode).toBe(400);
    }
  });

  it('asigna a una variante propia; una de otro producto → 400', async () => {
    const [image] = await images();
    const ok = await call('PATCH', `/${image!.id}`, { variantId: product.variants[0]!.id });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().variantId).toBe(product.variants[0]!.id);
    const back = await call('PATCH', `/${image!.id}`, { variantId: null });
    expect(back.json().variantId).toBeNull();

    const bad = await call('PATCH', `/${image!.id}`, { variantId: other.variants[0]!.id });
    expect(bad.statusCode).toBe(400);
  });

  it('quitar → 204 y la principal cambia', async () => {
    const [main, second] = await images();
    const res = await call('DELETE', `/${main!.id}`);
    expect(res.statusCode).toBe(204);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.id}`,
      headers: bearer(token),
    });
    expect(detail.json().thumbUrl).toBe(second!.thumbUrl);
    expect((await call('DELETE', `/${main!.id}`)).statusCode).toBe(404);
  });
});
