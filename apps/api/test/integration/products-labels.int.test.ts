import { LabelDataDto, type ProductDetailDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { imageUrls, simpleInput } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

describe('POST /products/labels (T26)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let zap: ProductDetailDto;
  let acc: ProductDetailDto;

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
    zap = await create({
      sku: 'ZAP0101',
      name: 'Zapato de piel dama',
      type: 'VARIABLE',
      price: 89900,
      variants: [
        { sku: 'ZAP0101-25-NEG', size: '25', color: 'Negro' },
        { sku: 'ZAP0101-26-NEG', size: '26', color: 'Negro', priceOverride: 95000 },
        { sku: 'ZAP0101-27-NEG', size: '27', color: 'Negro', material: 'Piel' },
      ],
    });
    acc = await create(simpleInput('ACC0301', { name: 'Cinturón' }));
    await prisma.productImage.createMany({
      data: [
        { productId: zap.id, ...imageUrls(1), sortOrder: 0 },
        { productId: zap.id, variantId: zap.variants[1]!.id, ...imageUrls(2), sortOrder: 1 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const labels = (items: { variantId: string; quantity: number }[], authToken = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/products/labels',
      headers: bearer(authToken),
      payload: { items },
    });

  it('devuelve un LabelDataDto por variante con precio, etiqueta de variante e imagen', async () => {
    const [v25, v26, v27] = zap.variants;
    const res = await labels([
      { variantId: v25!.id, quantity: 3 },
      { variantId: v26!.id, quantity: 1 },
      { variantId: v27!.id, quantity: 2 },
      { variantId: acc.variants[0]!.id, quantity: 1 },
    ]);
    expect(res.statusCode).toBe(200);
    const data = LabelDataDto.array().parse(res.json());
    expect(data).toEqual([
      expect.objectContaining({
        sku: 'ZAP0101-25-NEG',
        quantity: 3,
        productName: 'Zapato de piel dama',
        variantLabel: '25 · Negro',
        price: 89900,
        thumbUrl: imageUrls(1).thumbUrl, // la del producto
      }),
      expect.objectContaining({ quantity: 1, price: 95000, thumbUrl: imageUrls(2).thumbUrl }),
      expect.objectContaining({ variantLabel: '27 · Negro · Piel' }),
      expect.objectContaining({
        sku: 'ACC0301',
        variantLabel: null,
        price: 34900,
        thumbUrl: null,
      }),
    ]);
  });

  it('una variante inactiva (o de un producto inactivo) → 400', async () => {
    await prisma.product.update({ where: { id: acc.id }, data: { isActive: false } });
    const res = await labels([
      { variantId: zap.variants[0]!.id, quantity: 1 },
      { variantId: acc.variants[0]!.id, quantity: 1 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual([expect.objectContaining({ path: 'items.1.variantId' })]);
  });

  it('sin products.labels → 403', async () => {
    const seller = await createAndLogin(app, prisma, { username: 'vende' });
    const res = await labels([{ variantId: zap.variants[0]!.id, quantity: 1 }], seller.accessToken);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'products.labels' },
    });
  });
});
