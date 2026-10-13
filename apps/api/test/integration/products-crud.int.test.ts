import { type ProductDetailDto, ProductDetailDto as Detail } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { imageUrls, receiveStock, simpleInput, variableInput } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

describe('catálogo: alta, edición, estado y borrado (T8–T13)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let adminId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const admin = await loginSeeded(app, prisma, 'admin');
    token = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/products${url}`,
      headers: bearer(token),
      ...(payload ? { payload: payload as Record<string, unknown> } : {}),
    });
  const create = async (payload: object) => {
    const res = await send('POST', '', payload);
    expect(res.statusCode).toBe(201);
    return res.json() as ProductDetailDto;
  };

  describe('POST (T8)', () => {
    it('crea un VARIABLE con 4 variantes y su precio efectivo', async () => {
      const res = await send('POST', '', {
        ...variableInput('ZAP0101', ['23', '24', '25']),
        category: 'calzado > Dama',
        brand: 'Marca Nueva',
        cost: 45000,
        tags: ['piel'],
        variants: [
          { sku: 'ZAP0101-23-NEG', size: '23', color: 'Negro' },
          { sku: 'ZAP0101-24-NEG', size: '24', color: 'Negro' },
          { sku: 'ZAP0101-25-NEG', size: '25', color: 'Negro', priceOverride: 95000 },
          { sku: 'ZAP0101-25-CAF', size: '25', color: 'Café', barcode: '7501234567890' },
        ],
      });
      expect(res.statusCode).toBe(201);
      const product = Detail.parse(res.json());
      expect(product).toMatchObject({
        sku: 'ZAP0101',
        type: 'VARIABLE',
        category: { path: 'Calzado > Dama' },
        brand: { name: 'Marca Nueva' },
        variantCount: 4,
        totalStock: 0,
        hasHistory: false,
      });
      expect(product.variants.map((v) => [v.sku, v.effectivePrice])).toEqual([
        ['ZAP0101-23-NEG', 89900],
        ['ZAP0101-24-NEG', 89900],
        ['ZAP0101-25-CAF', 89900],
        ['ZAP0101-25-NEG', 95000],
      ]);
      expect(product.variants[2]).toMatchObject({
        barcode: '7501234567890',
        stock: { quantity: 0, reservedQty: 0, available: 0 },
        isEffectivelyActive: true,
      });
      const calzado = await prisma.category.findFirstOrThrow({ where: { name: 'Calzado' } });
      expect(await prisma.category.count({ where: { name: { in: ['Calzado', 'calzado'] } } })).toBe(
        1,
      );
      expect(
        await prisma.category.findFirstOrThrow({ where: { name: 'Dama', parentId: calzado.id } }),
      ).toBeDefined();
    });

    it('un SIMPLE tiene una variante con el SKU padre, sin atributos y con su barcode', async () => {
      const product = await create(
        simpleInput('ACC0301', { barcode: '7509999999999', brand: 'marca nueva' }),
      );
      expect(product.variants).toEqual([
        expect.objectContaining({
          sku: 'ACC0301',
          barcode: '7509999999999',
          size: null,
          color: null,
          material: null,
        }),
      ]);
      // La marca existente se reutiliza aunque cambie la capitalización.
      expect(product.brand?.name).toBe('Marca Nueva');
      expect(
        await prisma.brand.count({
          where: { name: { equals: 'marca nueva', mode: 'insensitive' } },
        }),
      ).toBe(1);
    });

    it('un SELLER → 403', async () => {
      const seller = await createAndLogin(app, prisma, { username: 'vende' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: bearer(seller.accessToken),
        payload: simpleInput('VEND01'),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'products.manage' },
      });
    });
  });

  describe('SKU_TAKEN (T9)', () => {
    beforeAll(async () => {
      await create(
        variableInput('BOL0201', ['A'], { variants: [{ sku: 'BOL0201-ROJ', color: 'Rojo' }] }),
      );
    });

    it.each([
      ['SKU padre repetido', () => simpleInput('BOL0201'), 'BOL0201', 'sku'],
      [
        'SKU de variante igual al SKU padre de otro producto',
        () => variableInput('BOL0202', [], { variants: [{ sku: 'BOL0201', color: 'Azul' }] }),
        'BOL0201',
        'variants.0.sku',
      ],
      [
        'SKU padre igual a una variante de otro producto',
        () => simpleInput('BOL0201-ROJ'),
        'BOL0201-ROJ',
        'sku',
      ],
      [
        'barcode repetido',
        () => simpleInput('ACC0302', { barcode: '7509999999999' }),
        '7509999999999',
        'barcode',
      ],
    ])('%s → 409 sin escrituras', async (_caso, payload, sku, field) => {
      const before = await prisma.product.count();
      const res = await send('POST', '', payload());
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'SKU_TAKEN', details: { sku, field } });
      expect(await prisma.product.count()).toBe(before);
    });
  });

  describe('PUT (T10)', () => {
    it('cambia datos, agrega, modifica por id y borra la omitida sin historial', async () => {
      const product = await create(variableInput('PUT0101', ['25', '26', '27']));
      const [v25, v26] = product.variants;
      const res = await send('PUT', `/${product.id}`, {
        ...variableInput('PUT0101'),
        name: 'Nombre nuevo',
        price: 99900,
        variants: [
          { id: v25!.id, sku: 'PUT0101-25', size: '25', color: 'Negro', priceOverride: 100000 },
          { id: v26!.id, sku: 'PUT0101-26B', size: '26', color: 'Blanco' },
          { sku: 'PUT0101-28', size: '28', color: 'Negro' },
        ],
      });
      expect(res.statusCode).toBe(200);
      const updated = Detail.parse(res.json());
      expect(updated).toMatchObject({ name: 'Nombre nuevo', price: 99900, variantCount: 3 });
      expect(updated.variants.map((v) => [v.sku, v.color, v.effectivePrice])).toEqual([
        ['PUT0101-25', 'Negro', 100000],
        ['PUT0101-26B', 'Blanco', 99900],
        ['PUT0101-28', 'Negro', 99900],
      ]);
      expect(updated.variants[0]!.id).toBe(v25!.id);
      expect(await prisma.productVariant.count({ where: { sku: 'PUT0101-27' } })).toBe(0);
    });

    it('omitir una variante con historial → 409 VARIANT_HAS_HISTORY y nada cambia', async () => {
      const product = await create(variableInput('PUT0102', ['25', '26']));
      const [v25, v26] = product.variants;
      await receiveStock(prisma, v26!.id, { userId: adminId, quantity: 2 });

      const res = await send('PUT', `/${product.id}`, {
        ...variableInput('PUT0102'),
        name: 'No debe cambiar',
        variants: [{ id: v25!.id, sku: 'PUT0102-25', size: '25', color: 'Negro' }],
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'VARIANT_HAS_HISTORY',
        details: { variantId: v26!.id, sku: 'PUT0102-26' },
      });
      const row = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: true },
      });
      expect(row.name).toBe('Producto PUT0102');
      expect(row.variants).toHaveLength(2);
    });

    it('un id de variante de otro producto → 400', async () => {
      const a = await create(variableInput('PUT0103', ['25']));
      const b = await create(variableInput('PUT0104', ['25']));
      const res = await send('PUT', `/${a.id}`, {
        ...variableInput('PUT0103'),
        variants: [{ id: b.variants[0]!.id, sku: 'PUT0103-25', size: '25' }],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toEqual([expect.objectContaining({ path: 'variants.0.id' })]);
    });
  });

  describe('cambio de tipo (T11)', () => {
    it('SIMPLE → VARIABLE sin historial reemplaza la variante por defecto', async () => {
      const product = await create(simpleInput('TIP0101'));
      const res = await send('PUT', `/${product.id}`, variableInput('TIP0101', ['25', '26']));
      expect(res.statusCode).toBe(200);
      const updated = res.json() as ProductDetailDto;
      expect(updated.type).toBe('VARIABLE');
      expect(updated.variants.map((v) => v.sku)).toEqual(['TIP0101-25', 'TIP0101-26']);
      expect(await prisma.productVariant.count({ where: { sku: 'TIP0101' } })).toBe(0);
    });

    it('con historial → 409 PRODUCT_TYPE_LOCKED', async () => {
      const product = await create(simpleInput('TIP0102'));
      await receiveStock(prisma, product.variants[0]!.id, { userId: adminId, quantity: 1 });
      const res = await send('PUT', `/${product.id}`, variableInput('TIP0102', ['25']));
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('PRODUCT_TYPE_LOCKED');
    });

    it('un SIMPLE editado actualiza el SKU y el barcode de su variante', async () => {
      const product = await create(simpleInput('TIP0103'));
      const res = await send(
        'PUT',
        `/${product.id}`,
        simpleInput('TIP0104', { barcode: '7500000000001' }),
      );
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductDetailDto).variants).toEqual([
        expect.objectContaining({
          id: product.variants[0]!.id,
          sku: 'TIP0104',
          barcode: '7500000000001',
        }),
      ]);
    });
  });

  describe('desactivar y reactivar (T12)', () => {
    it('son idempotentes; con el producto inactivo sus variantes no están activas', async () => {
      const product = await create(variableInput('ACT0101', ['25']));
      const variantId = product.variants[0]!.id;
      for (let i = 0; i < 2; i++) {
        const res = await send('POST', `/${product.id}/deactivate`);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
          isActive: false,
          variants: [{ isActive: true, isEffectivelyActive: false }],
        });
      }
      for (let i = 0; i < 2; i++) {
        const res = await send('POST', `/${product.id}/reactivate`);
        expect(res.json()).toMatchObject({
          isActive: true,
          variants: [{ isEffectivelyActive: true }],
        });
      }
      for (let i = 0; i < 2; i++) {
        const res = await send('POST', `/${product.id}/variants/${variantId}/deactivate`);
        expect(res.statusCode).toBe(200);
        expect(res.json().variants[0]).toMatchObject({
          isActive: false,
          isEffectivelyActive: false,
        });
      }
      const back = await send('POST', `/${product.id}/variants/${variantId}/reactivate`);
      expect(back.json().variants[0]).toMatchObject({ isActive: true, isEffectivelyActive: true });

      const missing = await send(
        'POST',
        `/${product.id}/variants/00000000-0000-4000-8000-000000000000/deactivate`,
      );
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('DELETE (T13)', () => {
    it('sin historial borra producto, variantes e imágenes y lo audita', async () => {
      const product = await create(variableInput('DEL0101', ['25', '26']));
      await prisma.productImage.create({
        data: { productId: product.id, ...imageUrls(1), sortOrder: 0 },
      });
      const res = await send('DELETE', `/${product.id}`);
      expect(res.statusCode).toBe(204);
      expect(await prisma.product.count({ where: { id: product.id } })).toBe(0);
      expect(await prisma.productVariant.count({ where: { productId: product.id } })).toBe(0);
      expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(0);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'product.delete' } });
      expect(log).toMatchObject({
        userId: adminId,
        entity: 'Product',
        entityId: product.id,
        payload: { sku: 'DEL0101', name: 'Producto DEL0101' },
      });
    });

    it('con historial → 409 PRODUCT_HAS_HISTORY; inexistente → 404', async () => {
      const product = await create(simpleInput('DEL0102'));
      await receiveStock(prisma, product.variants[0]!.id, { userId: adminId, quantity: 1 });
      const res = await send('DELETE', `/${product.id}`);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('PRODUCT_HAS_HISTORY');
      expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);

      const missing = await send('DELETE', '/00000000-0000-4000-8000-000000000000');
      expect(missing.statusCode).toBe(404);
    });
  });
});
