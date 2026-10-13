import { LookupResultDto, type ProductDetailDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { simpleInput } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

describe('GET /products/lookup (T17)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let product: ProductDetailDto;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    token = (await loginSeeded(app, prisma, 'admin')).accessToken;
    const create = async (payload: object) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/products',
          headers: bearer(token),
          payload: payload as Record<string, unknown>,
        })
      ).json() as ProductDetailDto;
    product = await create({
      sku: 'ZAP0101',
      name: 'Zapato',
      type: 'VARIABLE',
      price: 89900,
      variants: [
        { sku: 'ZAP0101-25-NEG', size: '25', color: 'Negro', barcode: '7501234567890' },
        { sku: 'ZAP0101-26-NEG', size: '26', color: 'Negro' },
      ],
    });
    await create(simpleInput('ACC0301'));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const lookup = (code: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/products/lookup?code=${encodeURIComponent(code)}`,
      headers: bearer(token),
    });

  it.each([
    ['un SKU de variante (sin mayúsculas)', 'zap0101-25-neg'],
    ['un código de barras', ' 7501234567890 '],
  ])('%s → match variant', async (_caso, code) => {
    const res = await lookup(code);
    expect(res.statusCode).toBe(200);
    const result = LookupResultDto.parse(res.json());
    expect(result).toMatchObject({
      match: 'variant',
      product: { id: product.id, sku: 'ZAP0101' },
      variant: { sku: 'ZAP0101-25-NEG' },
    });
    expect(res.json().product).not.toHaveProperty('variants');
  });

  it('un SKU padre → match product con sus variantes', async () => {
    const result = LookupResultDto.parse((await lookup('ZAP0101')).json());
    expect(result.match).toBe('product');
    if (result.match === 'product') {
      expect(result.variants.map((v) => v.sku)).toEqual(['ZAP0101-25-NEG', 'ZAP0101-26-NEG']);
    }
  });

  it('un código desconocido → 404', async () => {
    const res = await lookup('NOEXISTE');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND', message: 'No se encontró el producto.' });
  });

  it('una variante inactiva vuelve con isEffectivelyActive: false', async () => {
    await prisma.productVariant.update({
      where: { sku: 'ZAP0101-26-NEG' },
      data: { isActive: false },
    });
    const result = LookupResultDto.parse((await lookup('ZAP0101-26-NEG')).json());
    expect(result).toMatchObject({
      match: 'variant',
      variant: { isActive: false, isEffectivelyActive: false },
    });
  });
});
