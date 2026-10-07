import { z } from 'zod';
import { NonNegativeInt } from './common.js';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(100).optional(),
  ),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export type SortDirection = 'asc' | 'desc';

/** Esquema opcional que acepta `"campo:asc|desc"` con un campo permitido y devuelve `{ field, direction }`. */
export function sortQuery<const F extends readonly [string, ...string[]]>(fields: F) {
  return z
    .string()
    .transform((value, ctx) => {
      const [field, direction, ...rest] = value.split(':');
      if (
        rest.length > 0 ||
        !fields.includes(field as F[number]) ||
        (direction !== 'asc' && direction !== 'desc')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `Orden inválido; usa campo:asc o campo:desc con: ${fields.join(', ')}`,
        });
        return z.NEVER;
      }
      return { field: field as F[number], direction: direction as SortDirection };
    })
    .optional();
}

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: NonNegativeInt,
  });
}
