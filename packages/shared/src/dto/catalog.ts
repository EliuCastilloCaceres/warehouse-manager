import { z } from 'zod';
import { IsoDateTime, NonNegativeInt, Uuid } from '../common.js';
import { ProductType } from '../enums.js';
import { MoneyCents } from '../money.js';

export const CategoryDto = z.object({
  id: Uuid,
  name: z.string(),
  parentId: Uuid.nullable(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CategoryDto = z.infer<typeof CategoryDto>;

export const BrandDto = z.object({
  id: Uuid,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BrandDto = z.infer<typeof BrandDto>;

export const ProductDto = z.object({
  id: Uuid,
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: Uuid.nullable(),
  brandId: Uuid.nullable(),
  type: ProductType,
  price: MoneyCents,
  cost: MoneyCents.nullable(),
  tags: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProductDto = z.infer<typeof ProductDto>;

export const ProductVariantDto = z.object({
  id: Uuid,
  productId: Uuid,
  sku: z.string(),
  barcode: z.string().nullable(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  material: z.string().nullable(),
  priceOverride: MoneyCents.nullable(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProductVariantDto = z.infer<typeof ProductVariantDto>;

export const ProductImageDto = z.object({
  id: Uuid,
  productId: Uuid,
  variantId: Uuid.nullable(),
  url: z.string(),
  thumbUrl: z.string(),
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProductImageDto = z.infer<typeof ProductImageDto>;
