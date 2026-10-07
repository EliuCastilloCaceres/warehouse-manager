import { z } from 'zod';
import { PaginationQuery, paginated, sortQuery } from './index.js';

describe('paginación (T8)', () => {
  it('usa los defaults y convierte desde strings', () => {
    expect(PaginationQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(PaginationQuery.parse({ page: '3', pageSize: '50', q: ' zapato ' })).toEqual({
      page: 3,
      pageSize: 50,
      q: 'zapato',
    });
  });

  it.each([{ page: 0 }, { pageSize: 0 }, { pageSize: 101 }])('rechaza %o', (query) => {
    expect(PaginationQuery.safeParse(query).success).toBe(false);
  });

  it('convierte q vacío en undefined', () => {
    expect(PaginationQuery.parse({ q: '' }).q).toBeUndefined();
    expect(PaginationQuery.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('sortQuery acepta campos permitidos y direcciones válidas', () => {
    const sort = sortQuery(['name', 'sku']);
    expect(sort.parse('name:asc')).toEqual({ field: 'name', direction: 'asc' });
    expect(sort.parse('sku:desc')).toEqual({ field: 'sku', direction: 'desc' });
    expect(sort.parse(undefined)).toBeUndefined();
  });

  it.each(['price:asc', 'name:up', 'name', 'name:asc:x'])('sortQuery rechaza %p', (value) => {
    expect(sortQuery(['name', 'sku']).safeParse(value).success).toBe(false);
  });

  it('paginated valida items y total', () => {
    const schema = paginated(z.object({ id: z.string() }));
    expect(
      schema.safeParse({ items: [{ id: 'a' }], page: 1, pageSize: 20, total: 1 }).success,
    ).toBe(true);
    expect(schema.safeParse({ items: [{ id: 1 }], page: 1, pageSize: 20, total: 1 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ items: [], page: 1, pageSize: 20, total: -1 }).success).toBe(false);
  });
});
