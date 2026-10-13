import {
  type LabelDataDto,
  type LabelRequest,
  type LookupResultDto,
  normalizeSku,
  PRODUCT_IMAGE_MAX,
  type ProductCatalogsDto,
  type ProductDetailDto,
  type ProductImageAddInput,
  type ProductImageDto,
  type ProductListItemDto,
  type ProductListQuery,
  type ProductUpsertInput,
  type VariantDetailDto,
  type VariantInput,
  variantLabel,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, validationError } from '../../core/errors.js';
import { buildPage, containsInsensitive, toOrderBy, toPrismaPage } from '../../core/pagination.js';
import type { Prisma, ProductImage } from '../../generated/prisma/client.js';
import { categoryPaths, listCatalogs, resolveBrand, resolveCategory } from './catalogs.js';
import * as repo from './products.repository.js';
import type {
  ProductListRow,
  ProductRow,
  SkuCandidate,
  VariantRow,
} from './products.repository.js';

type Tx = Prisma.TransactionClient;
type Stock = Map<string, { quantity: number; reservedQty: number }>;

export interface ProductActor {
  userId: string;
  ip: string | null;
}

const IMAGE_URL = /^\/uploads\/product\/([0-9a-f-]{36})\.webp$/;

const notFound = () => new DomainError('NOT_FOUND', { message: 'No se encontró el producto.' });

const iso = (date: Date) => date.toISOString();

function toImageDto(image: ProductImage): ProductImageDto {
  return { ...image, createdAt: iso(image.createdAt), updatedAt: iso(image.updatedAt) };
}

function toListItem(
  row: ProductListRow | ProductRow,
  paths: Map<string, string>,
  totalStock: number,
): ProductListItemDto {
  const { category, brand, images, ...product } = row;
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    brandId: product.brandId,
    type: product.type,
    price: product.price,
    cost: product.cost,
    tags: product.tags,
    isActive: product.isActive,
    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
    category: category ? { id: category.id, path: paths.get(category.id)! } : null,
    brand: brand ? { id: brand.id, name: brand.name } : null,
    thumbUrl: images[0]?.thumbUrl ?? null,
    variantCount: '_count' in row ? row._count.variants : row.variants.length,
    totalStock,
  };
}

function toVariantDetail(
  variant: VariantRow,
  product: Pick<ProductRow, 'price' | 'isActive' | 'images'>,
  stock: Stock,
): VariantDetailDto {
  const { _count, ...fields } = variant;
  const { quantity = 0, reservedQty = 0 } = stock.get(variant.id) ?? {};
  const image = product.images.find((i) => i.variantId === variant.id) ?? product.images[0];
  return {
    ...fields,
    createdAt: iso(variant.createdAt),
    updatedAt: iso(variant.updatedAt),
    effectivePrice: variant.priceOverride ?? product.price,
    stock: { quantity, reservedQty, available: quantity - reservedQty },
    hasHistory: repo.hasHistory({ _count }),
    isEffectivelyActive: variant.isActive && product.isActive,
    thumbUrl: image?.thumbUrl ?? null,
  };
}

/** Variantes a guardar: la de un simple la arma el servidor (spec F6 §2). */
function variantsOf(input: ProductUpsertInput): VariantInput[] {
  if (input.type === 'VARIABLE') return input.variants;
  return [
    {
      sku: input.sku,
      barcode: input.barcode,
      size: null,
      color: null,
      material: null,
      priceOverride: null,
    },
  ];
}

const variantData = (v: VariantInput) => ({
  sku: v.sku,
  barcode: v.barcode,
  size: v.size,
  color: v.color,
  material: v.material,
  priceOverride: v.priceOverride,
});

/** SKUs y códigos de barras del input, con el campo del formulario de cada uno. */
function skuCandidates(input: ProductUpsertInput): {
  skus: SkuCandidate[];
  barcodes: SkuCandidate[];
} {
  if (input.type === 'SIMPLE') {
    return {
      skus: [{ sku: input.sku, field: 'sku' }],
      barcodes: input.barcode ? [{ sku: input.barcode, field: 'barcode' }] : [],
    };
  }
  return {
    skus: [
      { sku: input.sku, field: 'sku' },
      ...input.variants.map((v, i) => ({ sku: v.sku, field: `variants.${i}.sku` })),
    ],
    barcodes: input.variants.flatMap((v, i) =>
      v.barcode ? [{ sku: v.barcode, field: `variants.${i}.barcode` }] : [],
    ),
  };
}

/** Catálogo de productos, variantes e imágenes (spec F6). */
export class ProductsService {
  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async list(query: ProductListQuery, branchId: string) {
    const text = containsInsensitive(query.q);
    const where: Prisma.ProductWhereInput = {
      categoryId: query.categoryId,
      brandId: query.brandId,
      type: query.type,
      isActive: query.isActive,
      OR: text
        ? [
            { sku: text },
            { name: text },
            { variants: { some: { sku: text } } },
            { brand: { name: text } },
          ]
        : undefined,
    };
    const orderBy = [toOrderBy(query.sort, { field: 'name', direction: 'asc' }), { id: 'asc' }];
    const [total, rows] = await repo.listProducts(
      this.prisma,
      where,
      orderBy as Prisma.ProductOrderByWithRelationInput[],
      toPrismaPage(query),
    );
    const [paths, stock] = await Promise.all([
      categoryPaths(this.prisma),
      repo.stockByProduct(
        this.prisma,
        rows.map((r) => r.id),
        branchId,
      ),
    ]);
    return buildPage(
      rows.map((row) => toListItem(row, paths, stock.get(row.id) ?? 0)),
      total,
      query,
    );
  }

  catalogs(): Promise<ProductCatalogsDto> {
    return listCatalogs(this.prisma);
  }

  async get(id: string, branchId: string): Promise<ProductDetailDto> {
    return this.detail(await this.load(id), branchId);
  }

  async create(input: ProductUpsertInput, branchId: string): Promise<ProductDetailDto> {
    await this.assertSkusFree(input, null);
    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...(await this.productData(tx, input)),
          variants: { create: variantsOf(input).map(variantData) },
        },
      });
      return product.id;
    });
    return this.get(id, branchId);
  }

  /**
   * Reemplaza el conjunto de variantes (spec F6 §3): las del payload se actualizan por `id` o se
   * crean; una existente que falta se borra si no tiene historial (si tiene → 409).
   */
  async update(id: string, input: ProductUpsertInput, branchId: string): Promise<ProductDetailDto> {
    const product = await this.load(id);
    const productHasHistory = product.variants.some(repo.hasHistory);
    if (input.type !== product.type && productHasHistory) {
      throw new DomainError('PRODUCT_TYPE_LOCKED');
    }
    await this.assertSkusFree(input, id);

    const typeChanged = input.type !== product.type;
    const existing = new Map(product.variants.map((v) => [v.id, v]));
    let plan: { remove: VariantRow[]; update: VariantInput[]; create: VariantInput[] };
    if (typeChanged) {
      plan = { remove: product.variants, update: [], create: variantsOf(input) };
    } else if (input.type === 'SIMPLE') {
      const [current] = product.variants;
      const [next] = variantsOf(input);
      plan = current
        ? { remove: [], update: [{ ...next!, id: current.id }], create: [] }
        : { remove: [], update: [], create: [next!] };
    } else {
      input.variants.forEach((v, i) => {
        if (v.id && !existing.has(v.id)) {
          throw validationError(`variants.${i}.id`, 'La variante no pertenece al producto');
        }
      });
      const kept = new Set(input.variants.map((v) => v.id).filter(Boolean));
      plan = {
        remove: product.variants.filter((v) => !kept.has(v.id)),
        update: input.variants.filter((v) => v.id),
        create: input.variants.filter((v) => !v.id),
      };
    }
    const locked = plan.remove.find(repo.hasHistory);
    if (locked) {
      throw new DomainError('VARIANT_HAS_HISTORY', {
        details: { variantId: locked.id, sku: locked.sku },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: await this.productData(tx, input) });
      if (plan.remove.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: plan.remove.map((v) => v.id) } } });
      }
      for (const variant of plan.update) {
        await tx.productVariant.update({ where: { id: variant.id! }, data: variantData(variant) });
      }
      if (plan.create.length > 0) {
        await tx.productVariant.createMany({
          data: plan.create.map((v) => ({ productId: id, ...variantData(v) })),
        });
      }
    });
    return this.get(id, branchId);
  }

  /** Desactivar o reactivar; idempotente. */
  async setActive(id: string, isActive: boolean, branchId: string): Promise<ProductDetailDto> {
    const product = await this.load(id);
    if (product.isActive !== isActive) {
      await this.prisma.product.update({ where: { id }, data: { isActive } });
    }
    return this.get(id, branchId);
  }

  async setVariantActive(
    id: string,
    variantId: string,
    isActive: boolean,
    branchId: string,
  ): Promise<ProductDetailDto> {
    const product = await this.load(id);
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) throw new DomainError('NOT_FOUND', { message: 'No se encontró la variante.' });
    if (variant.isActive !== isActive) {
      await this.prisma.productVariant.update({ where: { id: variantId }, data: { isActive } });
    }
    return this.get(id, branchId);
  }

  /** Solo sin historial: borra producto, variantes e imágenes (los archivos quedan). */
  async delete(id: string, actor: ProductActor): Promise<void> {
    const product = await this.load(id);
    if (product.variants.some(repo.hasHistory)) throw new DomainError('PRODUCT_HAS_HISTORY');
    await this.prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'product.delete',
          entity: 'Product',
          entityId: id,
          payload: { sku: product.sku, name: product.name },
          ip: actor.ip,
        },
        tx,
      );
    });
  }

  /** Agrega al final una imagen subida antes con `/uploads/product-images`. */
  async addImage(id: string, input: ProductImageAddInput): Promise<ProductImageDto> {
    const product = await this.load(id);
    const url = IMAGE_URL.exec(input.url);
    if (!url) throw validationError('url', 'Imagen no válida');
    if (input.thumbUrl !== `/uploads/product/${url[1]}.thumb.webp`) {
      throw validationError('thumbUrl', 'La miniatura no corresponde a la imagen');
    }
    this.assertOwnVariant(product, input.variantId, 'variantId');
    if (product.images.length >= PRODUCT_IMAGE_MAX) {
      throw new DomainError('PRODUCT_IMAGE_LIMIT');
    }
    const sortOrder = Math.max(-1, ...product.images.map((i) => i.sortOrder)) + 1;
    const image = await this.prisma.productImage.create({
      data: {
        productId: id,
        variantId: input.variantId,
        url: input.url,
        thumbUrl: input.thumbUrl,
        sortOrder,
      },
    });
    return toImageDto(image);
  }

  /** Nuevo orden: deben venir exactamente las imágenes del producto. */
  async orderImages(id: string, imageIds: readonly string[]): Promise<ProductImageDto[]> {
    const product = await this.load(id);
    const current = new Set(product.images.map((i) => i.id));
    const requested = new Set(imageIds);
    if (
      requested.size !== imageIds.length ||
      requested.size !== current.size ||
      imageIds.some((imageId) => !current.has(imageId))
    ) {
      throw validationError('imageIds', 'Envía todas las imágenes del producto, sin repetir');
    }
    const images = await this.prisma.$transaction(
      imageIds.map((imageId, sortOrder) =>
        this.prisma.productImage.update({ where: { id: imageId }, data: { sortOrder } }),
      ),
    );
    return images.map(toImageDto);
  }

  async assignImage(
    id: string,
    imageId: string,
    variantId: string | null,
  ): Promise<ProductImageDto> {
    const product = await this.load(id);
    this.assertOwnImage(product, imageId);
    this.assertOwnVariant(product, variantId, 'variantId');
    const image = await this.prisma.productImage.update({
      where: { id: imageId },
      data: { variantId },
    });
    return toImageDto(image);
  }

  async deleteImage(id: string, imageId: string): Promise<void> {
    const product = await this.load(id);
    this.assertOwnImage(product, imageId);
    await this.prisma.productImage.delete({ where: { id: imageId } });
  }

  /** SKU de variante → código de barras → SKU padre (spec F6 §3). Incluye inactivos. */
  async lookup(code: string, branchId: string): Promise<LookupResultDto> {
    const value = normalizeSku(code);
    const variant =
      (await this.prisma.productVariant.findUnique({ where: { sku: value } })) ??
      (await this.prisma.productVariant.findUnique({ where: { barcode: value } }));
    const productId =
      variant?.productId ??
      (await this.prisma.product.findUnique({ where: { sku: value }, select: { id: true } }))?.id;
    if (!productId) throw notFound();
    // `product` es el detalle completo; la respuesta (`ProductListItemDto`) descarta lo demás.
    const product = await this.get(productId, branchId);
    if (variant) {
      return {
        match: 'variant',
        product,
        variant: product.variants.find((v) => v.id === variant.id)!,
      };
    }
    return { match: 'product', product, variants: product.variants };
  }

  /** Datos para dibujar etiquetas; cada variante debe existir y estar activa. */
  async labels(request: LabelRequest): Promise<LabelDataDto[]> {
    const ids = request.items.map((item) => item.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: ids } },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 },
        product: {
          include: { images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 } },
        },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return request.items.map((item, i) => {
      const variant = byId.get(item.variantId);
      if (!variant || !variant.isActive || !variant.product.isActive) {
        throw validationError(`items.${i}.variantId`, 'La variante no existe o está inactiva');
      }
      return {
        variantId: variant.id,
        quantity: item.quantity,
        sku: variant.sku,
        productName: variant.product.name,
        variantLabel: variantLabel(variant),
        price: variant.priceOverride ?? variant.product.price,
        thumbUrl: (variant.images[0] ?? variant.product.images[0])?.thumbUrl ?? null,
      };
    });
  }

  private async load(id: string): Promise<ProductRow> {
    const product = await repo.findProduct(this.prisma, id);
    if (!product) throw notFound();
    return product;
  }

  private async detail(product: ProductRow, branchId: string): Promise<ProductDetailDto> {
    const [paths, stock] = await Promise.all([
      categoryPaths(this.prisma),
      repo.stockByVariant(
        this.prisma,
        product.variants.map((v) => v.id),
        branchId,
      ),
    ]);
    const totalStock = [...stock.values()].reduce((sum, s) => sum + s.quantity, 0);
    return {
      ...toListItem(product, paths, totalStock),
      hasHistory: product.variants.some(repo.hasHistory),
      variants: product.variants.map((v) => toVariantDetail(v, product, stock)),
      images: product.images.map(toImageDto),
    };
  }

  /** Campos del producto; crea la categoría y la marca si no existen. */
  private async productData(tx: Tx, input: ProductUpsertInput) {
    return {
      sku: input.sku,
      name: input.name,
      description: input.description,
      categoryId: input.category ? await resolveCategory(tx, input.category) : null,
      brandId: input.brand ? await resolveBrand(tx, input.brand) : null,
      type: input.type,
      price: input.price,
      cost: input.cost,
      tags: input.tags,
    };
  }

  private async assertSkusFree(input: ProductUpsertInput, ownProductId: string | null) {
    const { skus, barcodes } = skuCandidates(input);
    const conflict = await repo.findSkuConflict(this.prisma, skus, barcodes, ownProductId);
    if (conflict) {
      throw new DomainError('SKU_TAKEN', { details: { sku: conflict.sku, field: conflict.field } });
    }
  }

  private assertOwnVariant(product: ProductRow, variantId: string | null, field: string) {
    if (variantId && !product.variants.some((v) => v.id === variantId)) {
      throw validationError(field, 'La variante no es de este producto');
    }
  }

  private assertOwnImage(product: ProductRow, imageId: string) {
    if (!product.images.some((i) => i.id === imageId)) {
      throw new DomainError('NOT_FOUND', { message: 'No se encontró la imagen.' });
    }
  }
}
