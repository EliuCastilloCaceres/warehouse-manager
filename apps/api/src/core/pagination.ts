import type { SortDirection } from '@warehouse-manager/shared';

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface Sort<F extends string = string> {
  field: F;
  direction: SortDirection;
}

/** `{ page: 3, pageSize: 20 }` → `{ skip: 40, take: 20 }`. */
export function toPrismaPage({ page, pageSize }: PageQuery): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Orden pedido (de `sortQuery`) o el orden por defecto, en formato `orderBy` de Prisma. */
export function toOrderBy<F extends string>(
  sort: Sort<F> | undefined,
  fallback: Sort<F>,
): Record<F, SortDirection> {
  const { field, direction } = sort ?? fallback;
  return { [field]: direction } as Record<F, SortDirection>;
}

/** Respuesta paginada `{ items, page, pageSize, total }` (contrato `paginated` de shared). */
export function buildPage<T>(items: T[], total: number, { page, pageSize }: PageQuery) {
  return { items, page, pageSize, total };
}

/** Filtro de texto sin distinguir mayúsculas; `undefined` si no hay búsqueda. */
export function containsInsensitive(
  q: string | undefined,
): { contains: string; mode: 'insensitive' } | undefined {
  return q ? { contains: q, mode: 'insensitive' } : undefined;
}
