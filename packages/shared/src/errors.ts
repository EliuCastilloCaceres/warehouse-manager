import { z } from 'zod';

// Cada spec posterior agrega sus códigos.
export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  'AUTH_INVALID_CREDENTIALS',
  'STOCK_INSUFFICIENT',
  'RACK_CAPACITY_EXCEEDED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorDto = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type ApiErrorDto = z.infer<typeof ApiErrorDto>;
