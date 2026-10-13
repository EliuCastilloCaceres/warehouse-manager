import {
  ImportValidationDto,
  LabelDataDto,
  LabelRequest,
  LookupResultDto,
  ProductDetailDto,
  ProductListQuery,
  ProductUpsertInput,
  variantLabel,
} from './index.js';

const UUID = (n: number) => `9a8b7c6d-5e4f-4a3b-8c2d-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-13T15:00:00.000Z';

const variable = (variants: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  sku: 'ZAP0101',
  name: 'Zapato de piel dama',
  type: 'VARIABLE',
  price: 89900,
  variants,
  ...extra,
});

const pathsOf = (input: unknown) =>
  ProductUpsertInput.safeParse(input).error?.issues.map((i) => i.path.join('.')) ?? [];

describe('ProductUpsertInput (T2)', () => {
  it('un VARIABLE válido aplica defaults y normaliza', () => {
    const parsed = ProductUpsertInput.parse(
      variable([{ sku: 'zap0101-25-neg', size: '25', color: ' Negro ' }], {
        category: ' Calzado >  Dama ',
      }),
    );
    expect(parsed).toMatchObject({
      category: 'Calzado > Dama',
      brand: null,
      cost: null,
      tags: [],
      barcode: null,
      variants: [
        {
          sku: 'ZAP0101-25-NEG',
          size: '25',
          color: 'Negro',
          material: null,
          barcode: null,
          priceOverride: null,
        },
      ],
    });
  });

  it('un SIMPLE con variantes → error', () => {
    expect(pathsOf({ ...variable([{ sku: 'ZAP0101-25', size: '25' }]), type: 'SIMPLE' })).toEqual([
      'variants',
    ]);
  });

  it('un VARIABLE sin variantes → error', () => {
    expect(pathsOf(variable([]))).toEqual(['variants']);
  });

  it('una variante sin atributos → error en variants[0]', () => {
    expect(pathsOf(variable([{ sku: 'ZAP0101-A', size: ' ' }]))).toEqual(['variants.0']);
  });

  it('una combinación repetida (Negro/negro) → error en variants[1]', () => {
    expect(
      pathsOf(
        variable([
          { sku: 'ZAP0101-25-NEG', size: '25', color: 'Negro' },
          { sku: 'ZAP0101-25-NEG2', size: '25', color: 'negro' },
        ]),
      ),
    ).toEqual(['variants.1']);
  });

  it('SKU de variante igual al padre o repetido → error en su sku', () => {
    expect(pathsOf(variable([{ sku: 'ZAP0101', size: '25' }]))).toEqual(['variants.0.sku']);
    expect(
      pathsOf(
        variable([
          { sku: 'ZAP0101-25', size: '25' },
          { sku: 'zap0101-25', size: '26' },
        ]),
      ),
    ).toEqual(['variants.1.sku']);
  });

  it('código de barras en un VARIABLE o repetido entre variantes → error', () => {
    expect(
      pathsOf(variable([{ sku: 'ZAP0101-25', size: '25' }], { barcode: '7501234567890' })),
    ).toEqual(['barcode']);
    expect(
      pathsOf(
        variable([
          { sku: 'ZAP0101-25', size: '25', barcode: '7501' },
          { sku: 'ZAP0101-26', size: '26', barcode: '7501' },
        ]),
      ),
    ).toEqual(['variants.1.barcode']);
  });

  it('precio con decimales → error', () => {
    expect(pathsOf({ sku: 'ACC0301', name: 'Cinturón', type: 'SIMPLE', price: 349.5 })).toEqual([
      'price',
    ]);
  });

  it('una categoría de 4 niveles → error', () => {
    const result = ProductUpsertInput.safeParse({
      sku: 'ACC0301',
      name: 'Cinturón',
      type: 'SIMPLE',
      price: 34900,
      category: 'A > B > C > D',
    });
    expect(result.error?.issues[0]).toMatchObject({
      path: ['category'],
      message: 'La categoría admite hasta 3 niveles',
    });
  });
});

describe('ProductListQuery y LabelRequest (T3)', () => {
  it('convierte isActive y type, y valida el orden', () => {
    expect(ProductListQuery.parse({ isActive: 'false', type: 'SIMPLE' })).toMatchObject({
      isActive: false,
      type: 'SIMPLE',
      page: 1,
      pageSize: 20,
    });
    expect(ProductListQuery.safeParse({ type: 'KIT' }).success).toBe(false);
    expect(ProductListQuery.parse({ sort: 'name:asc' }).sort).toEqual({
      field: 'name',
      direction: 'asc',
    });
    expect(ProductListQuery.safeParse({ sort: 'price:asc' }).success).toBe(false);
  });

  it('LabelRequest admite hasta 1 000 etiquetas en total', () => {
    const items = (quantities: number[]) =>
      quantities.map((quantity, i) => ({ variantId: UUID(i), quantity }));
    expect(LabelRequest.safeParse({ items: items([500, 500]) }).success).toBe(true);
    const result = LabelRequest.safeParse({ items: items([500, 500, 1]) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Máximo 1 000 etiquetas por solicitud');
  });
});

const variantDetail = {
  id: UUID(2),
  productId: UUID(1),
  sku: 'ZAP0101-25-NEG',
  barcode: null,
  size: '25',
  color: 'Negro',
  material: null,
  priceOverride: null,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  effectivePrice: 89900,
  stock: { quantity: 5, reservedQty: 1, available: 4 },
  hasHistory: true,
  isEffectivelyActive: true,
  thumbUrl: null,
};
const listItem = {
  id: UUID(1),
  sku: 'ZAP0101',
  name: 'Zapato de piel dama',
  description: null,
  categoryId: UUID(3),
  brandId: null,
  type: 'VARIABLE',
  price: 89900,
  cost: 45000,
  tags: ['piel'],
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  category: { id: UUID(3), path: 'Calzado > Dama' },
  brand: null,
  thumbUrl: '/uploads/product/x.thumb.webp',
  variantCount: 1,
  totalStock: 5,
};

describe('DTOs de productos (T7)', () => {
  it('las fixtures son válidas', () => {
    expect(
      ProductDetailDto.safeParse({
        ...listItem,
        hasHistory: true,
        variants: [variantDetail],
        images: [
          {
            id: UUID(4),
            productId: UUID(1),
            variantId: null,
            url: '/uploads/product/x.webp',
            thumbUrl: '/uploads/product/x.thumb.webp',
            sortOrder: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      LookupResultDto.safeParse({ match: 'variant', product: listItem, variant: variantDetail })
        .success,
    ).toBe(true);
    expect(
      LookupResultDto.safeParse({ match: 'product', product: listItem, variants: [variantDetail] })
        .success,
    ).toBe(true);
    expect(
      ImportValidationDto.safeParse({
        issues: [{ rowNumber: 2, field: 'precio', message: 'Escribe un importe' }],
        summary: {
          productsToCreate: 1,
          productsToUpdate: 0,
          variantsToCreate: 2,
          variantsToUpdate: 0,
          categoriesToCreate: ['Calzado > Dama'],
          brandsToCreate: [],
          stock: {
            units: 3,
            rows: 2,
            unitsToStaging: 3,
            addingToExisting: { units: 0, variants: 0 },
          },
        },
      }).success,
    ).toBe(true);
    expect(
      LabelDataDto.safeParse({
        variantId: UUID(2),
        quantity: 3,
        sku: 'ZAP0101-25-NEG',
        productName: 'Zapato de piel dama',
        variantLabel: '25 · Negro',
        price: 89900,
        thumbUrl: null,
      }).success,
    ).toBe(true);
  });

  it('variantLabel une los atributos y es null sin ellos', () => {
    expect(variantLabel({ size: '25', color: 'Negro', material: 'Piel' })).toBe(
      '25 · Negro · Piel',
    );
    expect(variantLabel({ size: null, color: null, material: null })).toBeNull();
  });
});
