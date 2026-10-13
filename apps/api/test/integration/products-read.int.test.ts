import {
  ProductCatalogsDto,
  ProductDetailDto,
  ProductListItemDto,
  type ProductDetailDto as Detail,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { imageUrls, receiveStock, simpleInput, variableInput } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

interface Page {
  items: ProductListItemDto[];
  total: number;
}

describe('lectura del catálogo (T14, T15)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let adminId: string;
  const ids = { zap: '', bol: '', acc: '', calzado: '' };

  const get = async (url: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products${url}`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const skus = (page: Page) => page.items.map((item) => item.sku);

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const admin = await loginSeeded(app, prisma, 'admin');
    token = admin.accessToken;
    adminId = admin.userId;
    const create = async (payload: object) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: bearer(token),
        payload: payload as Record<string, unknown>,
      });
      return res.json() as Detail;
    };
    const zap = await create(
      variableInput('ZAP0101', ['25', '26'], {
        name: 'Zapato de piel',
        category: 'Calzado',
        brand: 'Andrea',
      }),
    );
    const bol = await create(
      variableInput('BOL0201', [], {
        name: 'Bolso tote',
        category: 'Bolsos',
        variants: [{ sku: 'BOL0201-ROJ', color: 'Rojo' }],
      }),
    );
    const acc = await create(simpleInput('ACC0301', { name: 'Cinturón', category: 'Accesorios' }));
    ids.zap = zap.id;
    ids.bol = bol.id;
    ids.acc = acc.id;
    ids.calzado = zap.categoryId!;
    await prisma.product.update({ where: { id: acc.id }, data: { isActive: false } });

    // Imágenes: una general (la segunda en orden) y una de la talla 26, que es la principal.
    const [v25, v26] = zap.variants;
    await prisma.productImage.createMany({
      data: [
        { productId: zap.id, ...imageUrls(1), sortOrder: 1 },
        { productId: zap.id, variantId: v26!.id, ...imageUrls(2), sortOrder: 0 },
      ],
    });
    await receiveStock(prisma, v25!.id, { userId: adminId, quantity: 5 });
    await receiveStock(prisma, v26!.id, { userId: adminId, quantity: 3 });
    // Stock en otra sucursal: no suma en S1.
    await receiveStock(prisma, v25!.id, { userId: adminId, quantity: 7, branch: 'S2' });
    const reserve = await prisma.stockLocation.findFirstOrThrow({
      where: { variantId: v25!.id, rack: { warehouse: { branch: { code: 'S1' } } } },
    });
    await prisma.stockLocation.update({ where: { id: reserve.id }, data: { reservedQty: 2 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /products (T14)', () => {
    it('ordena por nombre y trae imagen principal, variantes y stock de la sucursal', async () => {
      const page = (await get('')) as Page;
      expect(skus(page)).toEqual(['BOL0201', 'ACC0301', 'ZAP0101']);
      for (const item of page.items) expect(ProductListItemDto.safeParse(item).success).toBe(true);
      const zap = page.items.find((item) => item.sku === 'ZAP0101')!;
      expect(zap).toMatchObject({
        thumbUrl: imageUrls(2).thumbUrl,
        variantCount: 2,
        totalStock: 8,
        category: { id: ids.calzado, path: 'Calzado' },
        brand: { name: 'Andrea' },
      });
    });

    it.each([
      ['SKU padre', 'zap0101', ['ZAP0101']],
      ['SKU de variante', 'bol0201-roj', ['BOL0201']],
      ['nombre', 'CINTUR', ['ACC0301']],
      ['marca', 'andrea', ['ZAP0101']],
    ])('q busca por %s', async (_caso, q, expected) => {
      expect(skus(await get(`?q=${q}`))).toEqual(expected);
    });

    it('filtra por categoría, tipo y estado, y pagina', async () => {
      expect(skus(await get(`?categoryId=${ids.calzado}`))).toEqual(['ZAP0101']);
      expect(skus(await get('?type=SIMPLE'))).toEqual(['ACC0301']);
      expect(skus(await get('?isActive=false'))).toEqual(['ACC0301']);
      const page = (await get('?page=2&pageSize=2')) as Page;
      expect(page.total).toBe(3);
      expect(skus(page)).toEqual(['ZAP0101']);
    });

    it('GET /catalogs devuelve rutas y marcas', async () => {
      const catalogs = ProductCatalogsDto.parse(await get('/catalogs'));
      expect(catalogs.categories.map((c) => c.path)).toEqual(
        expect.arrayContaining(['Accesorios', 'Bolsos', 'Calzado']),
      );
      expect(catalogs.brands.map((b) => b.name)).toContain('Andrea');
    });
  });

  describe('GET /products/:id (T15)', () => {
    it('trae el stock por variante solo de la sucursal actual, historial e imágenes', async () => {
      const product = ProductDetailDto.parse(await get(`/${ids.zap}`));
      const [v25, v26] = product.variants;
      expect(v25).toMatchObject({
        sku: 'ZAP0101-25',
        stock: { quantity: 5, reservedQty: 2, available: 3 },
        hasHistory: true,
        // Sin imagen propia: usa la principal del producto.
        thumbUrl: imageUrls(2).thumbUrl,
      });
      expect(v26).toMatchObject({
        stock: { quantity: 3, reservedQty: 0, available: 3 },
        thumbUrl: imageUrls(2).thumbUrl,
      });
      expect(product).toMatchObject({ hasHistory: true, totalStock: 8 });
      expect(product.images.map((i) => i.sortOrder)).toEqual([0, 1]);
    });

    it('una variante con imagen propia la usa; sin historial ni stock en un producto nuevo', async () => {
      const bol = ProductDetailDto.parse(await get(`/${ids.bol}`));
      expect(bol).toMatchObject({ hasHistory: false, totalStock: 0, thumbUrl: null });
      const image = await prisma.productImage.create({
        data: { productId: ids.bol, variantId: bol.variants[0]!.id, ...imageUrls(3), sortOrder: 0 },
      });
      const again = ProductDetailDto.parse(await get(`/${ids.bol}`));
      expect(again.variants[0]!.thumbUrl).toBe(image.thumbUrl);
    });

    it('inexistente → 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products/00000000-0000-4000-8000-000000000000',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });
  });
});
