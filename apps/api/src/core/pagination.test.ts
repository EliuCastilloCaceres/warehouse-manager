import { buildPage, containsInsensitive, toOrderBy, toPrismaPage } from './pagination.js';

describe('paginación de la API (T6)', () => {
  it('toPrismaPage calcula skip y take', () => {
    expect(toPrismaPage({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(toPrismaPage({ page: 1, pageSize: 50 })).toEqual({ skip: 0, take: 50 });
  });

  it('toOrderBy usa el orden explícito o el de por defecto', () => {
    const fallback = { field: 'fullName', direction: 'asc' } as const;
    expect(toOrderBy(undefined, fallback)).toEqual({ fullName: 'asc' });
    expect(toOrderBy({ field: 'username', direction: 'desc' }, fallback)).toEqual({
      username: 'desc',
    });
  });

  it('buildPage arma la respuesta paginada', () => {
    expect(buildPage([{ id: 1 }], 41, { page: 3, pageSize: 20 })).toEqual({
      items: [{ id: 1 }],
      page: 3,
      pageSize: 20,
      total: 41,
    });
  });

  it('containsInsensitive', () => {
    expect(containsInsensitive('zap')).toEqual({ contains: 'zap', mode: 'insensitive' });
    expect(containsInsensitive(undefined)).toBeUndefined();
  });
});
