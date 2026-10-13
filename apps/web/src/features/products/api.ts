import {
  ImageUploadDto,
  ImportParseDto,
  ImportSummary,
  ImportValidationDto,
  LabelDataDto,
  LookupResultDto,
  paginated,
  ProductCatalogsDto,
  ProductDetailDto,
  ProductImageDto,
  ProductListItemDto,
  type ImportCommitInput,
  type ImportValidateInput,
  type LabelRequest,
  type ProductType,
  type ProductUpsertInput,
} from '@warehouse-manager/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiClientConfig, apiFetch } from '@/shared/api/apiClient';
import { toApiError } from '@/shared/api/errors';
import { refreshSession } from '@/shared/api/refresh';

const BASE = '/api/v1/products';
const ProductPage = paginated(ProductListItemDto);

export type ProductStatusFilter = 'active' | 'inactive' | 'all';

export interface ProductFilters {
  q: string;
  status: ProductStatusFilter;
  type: ProductType | '';
  categoryId: string;
  page: number;
}

export const PRODUCTS_PAGE_SIZE = 20;

/** Query string de `GET /products` (spec F6 §6); los filtros vacíos no se envían. */
export function productsSearch({ q, status, type, categoryId, page }: ProductFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PRODUCTS_PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (status !== 'all') params.set('isActive', String(status === 'active'));
  if (type) params.set('type', type);
  if (categoryId) params.set('categoryId', categoryId);
  return params.toString();
}

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}?${productsSearch(filters)}`, { schema: ProductPage, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: ({ signal }) => apiFetch(`${BASE}/${id}`, { schema: ProductDetailDto, signal }),
    enabled: !!id,
  });
}

export function useProductCatalogs() {
  return useQuery({
    queryKey: ['product-catalogs'],
    queryFn: ({ signal }) => apiFetch(`${BASE}/catalogs`, { schema: ProductCatalogsDto, signal }),
  });
}

/** Tras una mutación: lista, detalle y (si se crearon) categorías y marcas. */
export function useInvalidateProducts() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        ['products', 'product', 'product-catalogs'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    [queryClient],
  );
}

const post = <T>(path: string, schema: { parse: (v: unknown) => T }, body?: unknown) =>
  apiFetch(`${BASE}${path}`, { method: 'POST', body, schema });

export const productsApi = {
  lookup: (code: string) =>
    apiFetch(`${BASE}/lookup?${new URLSearchParams({ code })}`, { schema: LookupResultDto }),
  create: (input: ProductUpsertInput) => post('', ProductDetailDto, input),
  update: (id: string, input: ProductUpsertInput) =>
    apiFetch(`${BASE}/${id}`, { method: 'PUT', body: input, schema: ProductDetailDto }),
  setActive: (id: string, isActive: boolean) =>
    post(`/${id}/${isActive ? 'reactivate' : 'deactivate'}`, ProductDetailDto),
  setVariantActive: (id: string, variantId: string, isActive: boolean) =>
    post(
      `/${id}/variants/${variantId}/${isActive ? 'reactivate' : 'deactivate'}`,
      ProductDetailDto,
    ),
  remove: (id: string) => apiFetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch('/api/v1/uploads/product-images', {
      method: 'POST',
      body: form,
      schema: ImageUploadDto,
    });
  },
  addImage: (id: string, image: { url: string; thumbUrl: string }) =>
    post(`/${id}/images`, ProductImageDto, image),
  orderImages: (id: string, imageIds: string[]) =>
    apiFetch(`${BASE}/${id}/images/order`, {
      method: 'PUT',
      body: { imageIds },
      schema: ProductImageDto.array(),
    }),
  assignImage: (id: string, imageId: string, variantId: string | null) =>
    apiFetch(`${BASE}/${id}/images/${imageId}`, {
      method: 'PATCH',
      body: { variantId },
      schema: ProductImageDto,
    }),
  removeImage: (id: string, imageId: string) =>
    apiFetch<void>(`${BASE}/${id}/images/${imageId}`, { method: 'DELETE' }),

  labels: (request: LabelRequest) => post('/labels', LabelDataDto.array(), request),

  parseImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return post('/import/parse', ImportParseDto, form);
  },
  validateImport: (input: ImportValidateInput) =>
    post('/import/validate', ImportValidationDto, input),
  commitImport: (input: ImportCommitInput) => post('/import/commit', ImportSummary, input),
};

/** Descarga la plantilla `.xlsx` (con el token; si expiró, renueva la sesión una vez). */
export async function downloadImportTemplate(): Promise<void> {
  const request = () =>
    fetch(`${BASE}/import/template`, {
      headers: { authorization: `Bearer ${apiClientConfig().getAccessToken() ?? ''}` },
      credentials: 'same-origin',
    });
  let response = await request();
  if (response.status === 401) {
    await refreshSession();
    response = await request();
  }
  if (!response.ok) throw await toApiError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'plantilla-productos.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}
