import { z } from 'zod';

// Cada spec posterior agrega sus códigos.
export const ErrorCode = z.enum([
  // F1
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  'AUTH_INVALID_CREDENTIALS',
  'STOCK_INSUFFICIENT',
  'RACK_CAPACITY_EXCEEDED',
  // F2
  'AUTH_REFRESH_INVALID',
  'AUTH_REFRESH_REUSED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTH_PASSWORD_INCORRECT',
  'AUTH_ORIGIN_FORBIDDEN',
  'BRANCH_FORBIDDEN',
  'BRANCH_REQUIRED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'DB_UNAVAILABLE',
  'RACK_INACTIVE',
  'INVENTORY_CROSS_WAREHOUSE',
  'INVENTORY_INVALID_OPERATION',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Elemento de `details` en un `VALIDATION_ERROR`. */
export const ValidationIssue = z.object({ path: z.string(), message: z.string() });
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ApiErrorDto = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type ApiErrorDto = z.infer<typeof ApiErrorDto>;
