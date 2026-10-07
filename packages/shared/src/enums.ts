import { z } from 'zod';

// Mismos nombres y valores que los enums de apps/api/prisma/schema.prisma (lo verifica T14 de F1).

export const UserType = z.enum(['STAFF']);
export type UserType = z.infer<typeof UserType>;

export const ProductType = z.enum(['SIMPLE', 'VARIABLE']);
export type ProductType = z.infer<typeof ProductType>;

export const InventoryMovementType = z.enum([
  'INITIAL_LOAD',
  'PUTAWAY',
  'RELOCATE',
  'PICK',
  'RETURN_TO_RACK',
  'TO_STAGING',
  'SALE',
  'SALE_CANCEL',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
]);
export type InventoryMovementType = z.infer<typeof InventoryMovementType>;

export const InventoryReferenceType = z.enum(['CART', 'SALE']);
export type InventoryReferenceType = z.infer<typeof InventoryReferenceType>;

export const CashSessionStatus = z.enum(['OPEN', 'CLOSED']);
export type CashSessionStatus = z.infer<typeof CashSessionStatus>;

export const CartStatus = z.enum(['ACTIVE', 'SUSPENDED', 'CHECKED_OUT', 'DISCARDED']);
export type CartStatus = z.infer<typeof CartStatus>;

export const SaleStatus = z.enum(['COMPLETED', 'CANCELLED']);
export type SaleStatus = z.infer<typeof SaleStatus>;

export const PaymentMethod = z.enum(['CASH', 'CARD', 'TRANSFER']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const BranchCounterKey = z.enum(['SALE_FOLIO']);
export type BranchCounterKey = z.infer<typeof BranchCounterKey>;

export const AdjustmentReason = z.enum([
  'PHYSICAL_COUNT',
  'DAMAGE',
  'LOSS',
  'FOUND',
  'DATA_ENTRY_ERROR',
  'OTHER',
]);
export type AdjustmentReason = z.infer<typeof AdjustmentReason>;
