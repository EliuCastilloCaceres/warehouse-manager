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
  // F4
  'USER_OWNER_PROTECTED',
  'USER_OUT_OF_SCOPE',
  'USER_SELF_CHANGE_FORBIDDEN',
  'PERMISSION_ESCALATION',
  // F6
  'SKU_TAKEN',
  'PRODUCT_HAS_HISTORY',
  'VARIANT_HAS_HISTORY',
  'PRODUCT_TYPE_LOCKED',
  'PRODUCT_IMAGE_LIMIT',
  'IMPORT_INVALID',
  'IMPORT_CONFIRMATION_REQUIRED',
  // F7
  'RACK_HAS_STOCK',
  'STRUCTURE_HAS_HISTORY',
  'STRUCTURE_LOCKED',
  'STRUCTURE_FULL',
  // F8
  'NO_OPEN_CASH_SESSION',
  'CASH_SESSION_ALREADY_OPEN',
  'CASH_SESSION_CLOSED',
  'CASH_SESSION_HAS_OPEN_CARTS',
  'CART_LIMIT_REACHED',
  'CART_NOT_EDITABLE',
  'CART_EMPTY',
  'VARIANT_INACTIVE',
  'PAYMENT_TOTAL_MISMATCH',
  'SALE_ALREADY_CANCELLED',
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
