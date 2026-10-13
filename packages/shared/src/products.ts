import { z } from 'zod';
import { NonNegativeInt, Quantity, Uuid } from './common.js';
import { ProductDto, ProductImageDto, ProductVariantDto } from './dto/catalog.js';
import { ProductType } from './enums.js';
import { MoneyCents } from './money.js';
import { PaginationQuery, sortQuery } from './pagination.js';
import { SkuSchema } from './sku.js';

/** Ruta de categoría de hasta 3 niveles: `" Calzado >  Dama "` → `"Calzado > Dama"`. */
export const CategoryPath = z
  .string()
  .trim()
  .transform((v) =>
    v
      .split('>')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().max(60, 'Cada nivel de la categoría admite hasta 60 caracteres'))
      .min(1, 'Escribe la categoría')
      .max(3, 'La categoría admite hasta 3 niveles'),
  )
  .transform((parts) => parts.join(' > '));

const Attr = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const VariantInput = z.object({
  id: Uuid.optional(),
  sku: SkuSchema,
  barcode: SkuSchema.nullable().default(null),
  size: Attr.default(null),
  color: Attr.default(null),
  material: Attr.default(null),
  priceOverride: MoneyCents.nullable().default(null),
});
export type VariantInput = z.infer<typeof VariantInput>;

/** Clave de la combinación de atributos, sin distinguir mayúsculas (spec F6 §2). */
export function variantKey(v: {
  size: string | null;
  color: string | null;
  material: string | null;
}): string {
  return [v.size, v.color, v.material].map((a) => (a ?? '').trim().toLowerCase()).join('|');
}

export const ProductUpsertInput = z
  .object({
    sku: SkuSchema,
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
    description: z.string().trim().max(2000).nullable().default(null),
    category: CategoryPath.nullable().default(null),
    brand: z.string().trim().min(1).max(60).nullable().default(null),
    type: ProductType,
    price: MoneyCents,
    cost: MoneyCents.nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    barcode: SkuSchema.nullable().default(null), // solo SIMPLE
    variants: z.array(VariantInput).default([]), // solo VARIABLE
  })
  .superRefine((product, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (product.type === 'SIMPLE') {
      if (product.variants.length > 0) {
        issue(['variants'], 'Un producto simple no tiene variantes');
      }
      return;
    }
    if (product.barcode) issue(['barcode'], 'El código de barras va en cada variante');
    if (product.variants.length === 0) {
      issue(['variants'], 'Agrega al menos una variante');
      return;
    }
    const skus = new Set<string>();
    const barcodes = new Set<string>();
    const combinations = new Set<string>();
    product.variants.forEach((variant, i) => {
      if (!variant.size && !variant.color && !variant.material) {
        issue(['variants', i], 'La variante necesita talla, color o material');
      } else {
        const key = variantKey(variant);
        if (combinations.has(key)) issue(['variants', i], 'Esa combinación ya existe');
        combinations.add(key);
      }
      if (variant.sku === product.sku) {
        issue(['variants', i, 'sku'], 'El SKU de la variante debe ser distinto del SKU padre');
      } else if (skus.has(variant.sku)) {
        issue(['variants', i, 'sku'], 'Ese SKU está repetido');
      }
      skus.add(variant.sku);
      if (variant.barcode) {
        if (barcodes.has(variant.barcode)) {
          issue(['variants', i, 'barcode'], 'Ese código de barras está repetido');
        }
        barcodes.add(variant.barcode);
      }
    });
  });
export type ProductUpsertInput = z.infer<typeof ProductUpsertInput>;

export const PRODUCT_SORT_FIELDS = ['name', 'sku', 'createdAt'] as const;

export const ProductListQuery = PaginationQuery.extend({
  categoryId: Uuid.optional(),
  brandId: Uuid.optional(),
  type: ProductType.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: sortQuery(PRODUCT_SORT_FIELDS), // por defecto: name:asc
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

export const StockSummary = z.object({
  quantity: NonNegativeInt,
  reservedQty: NonNegativeInt,
  available: NonNegativeInt,
});
export type StockSummary = z.infer<typeof StockSummary>;

const CategoryRef = z.object({ id: Uuid, path: z.string() });
const BrandRef = z.object({ id: Uuid, name: z.string() });

export const ProductListItemDto = ProductDto.extend({
  category: CategoryRef.nullable(),
  brand: BrandRef.nullable(),
  thumbUrl: z.string().nullable(),
  variantCount: NonNegativeInt,
  totalStock: NonNegativeInt,
});
export type ProductListItemDto = z.infer<typeof ProductListItemDto>;

export const VariantDetailDto = ProductVariantDto.extend({
  effectivePrice: MoneyCents,
  stock: StockSummary,
  hasHistory: z.boolean(),
  isEffectivelyActive: z.boolean(),
  thumbUrl: z.string().nullable(),
});
export type VariantDetailDto = z.infer<typeof VariantDetailDto>;

export const ProductDetailDto = ProductListItemDto.extend({
  hasHistory: z.boolean(),
  variants: z.array(VariantDetailDto),
  images: z.array(ProductImageDto),
});
export type ProductDetailDto = z.infer<typeof ProductDetailDto>;

export const LookupResultDto = z.discriminatedUnion('match', [
  z.object({ match: z.literal('variant'), product: ProductListItemDto, variant: VariantDetailDto }),
  z.object({
    match: z.literal('product'),
    product: ProductListItemDto,
    variants: z.array(VariantDetailDto),
  }),
]);
export type LookupResultDto = z.infer<typeof LookupResultDto>;

export const ProductCatalogsDto = z.object({
  categories: z.array(CategoryRef),
  brands: z.array(BrandRef),
});
export type ProductCatalogsDto = z.infer<typeof ProductCatalogsDto>;

export const ProductImageAddInput = z.object({
  url: z.string(),
  thumbUrl: z.string(),
  variantId: Uuid.nullable().default(null),
});
export type ProductImageAddInput = z.infer<typeof ProductImageAddInput>;

export const PRODUCT_IMAGE_MAX = 10;

export const ProductImageOrderInput = z.object({
  imageIds: z.array(Uuid).min(1).max(PRODUCT_IMAGE_MAX),
});
export type ProductImageOrderInput = z.infer<typeof ProductImageOrderInput>;

export const ProductImageAssignInput = z.object({ variantId: Uuid.nullable() });
export type ProductImageAssignInput = z.infer<typeof ProductImageAssignInput>;

export const LABELS_MAX = 1000;

export const LabelRequest = z
  .object({
    items: z
      .array(z.object({ variantId: Uuid, quantity: z.number().int().min(1).max(500) }))
      .min(1),
  })
  .refine((v) => v.items.reduce((s, i) => s + i.quantity, 0) <= LABELS_MAX, {
    message: 'Máximo 1 000 etiquetas por solicitud',
  });
export type LabelRequest = z.infer<typeof LabelRequest>;

export const LabelDataDto = z.object({
  variantId: Uuid,
  quantity: Quantity,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(), // "25 · Negro · Piel"
  price: MoneyCents,
  thumbUrl: z.string().nullable(),
});
export type LabelDataDto = z.infer<typeof LabelDataDto>;

/** `"25 · Negro · Piel"`; sin atributos (variante de un simple) → `null`. */
export function variantLabel(v: {
  size: string | null;
  color: string | null;
  material: string | null;
}): string | null {
  const parts = [v.size, v.color, v.material].filter((a): a is string => !!a);
  return parts.length > 0 ? parts.join(' · ') : null;
}
