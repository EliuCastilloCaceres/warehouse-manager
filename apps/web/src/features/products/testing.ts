// Datos de prueba de productos (solo los importan los tests).
import type {
  ProductDetailDto,
  ProductListItemDto,
  VariantDetailDto,
} from '@warehouse-manager/shared';
import { type ProductFilters, productsSearch } from './api';

const NOW = '2026-10-13T15:00:00.000Z';
let counter = 0;
const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function makeListItem(overrides: Partial<ProductListItemDto> = {}): ProductListItemDto {
  return {
    id: uuid('dddddddd'),
    sku: 'ZAP0101',
    name: 'Zapato de piel dama',
    description: null,
    categoryId: null,
    brandId: null,
    type: 'VARIABLE',
    price: 89900,
    cost: 45000,
    tags: [],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    category: null,
    brand: null,
    thumbUrl: null,
    variantCount: 2,
    totalStock: 5,
    ...overrides,
  };
}

export function makeVariant(
  productId: string,
  overrides: Partial<VariantDetailDto> = {},
): VariantDetailDto {
  return {
    id: uuid('eeeeeeee'),
    productId,
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
    stock: { quantity: 0, reservedQty: 0, available: 0 },
    hasHistory: false,
    isEffectivelyActive: true,
    thumbUrl: null,
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  const base = makeListItem(overrides);
  const variants = overrides.variants ?? [
    makeVariant(base.id, { sku: 'ZAP0101-25-NEG', size: '25' }),
    makeVariant(base.id, { sku: 'ZAP0101-26-NEG', size: '26' }),
  ];
  return {
    ...base,
    hasHistory: false,
    images: [],
    ...overrides,
    variants,
    variantCount: variants.length,
  };
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  q: '',
  status: 'active',
  type: '',
  categoryId: '',
  page: 1,
};

/** Clave de `mockFetch` para `GET /products` con esos filtros. */
export const productsKey = (filters: Partial<ProductFilters> = {}) =>
  `GET /api/v1/products?${productsSearch({ ...DEFAULT_PRODUCT_FILTERS, ...filters })}`;

export const CATALOGS = {
  categories: [
    { id: 'cccccccc-0000-4000-8000-000000000001', path: 'Calzado' },
    { id: 'cccccccc-0000-4000-8000-000000000002', path: 'Calzado > Dama' },
  ],
  brands: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Demo Calzado' }],
};
