import { z } from 'zod';
import { BasisPoints, IsoDateTime, Quantity, Uuid } from '../common.js';
import { CartStatus, PaymentMethod, SaleStatus } from '../enums.js';
import { MoneyCents } from '../money.js';

export const CartDto = z.object({
  id: Uuid,
  branchId: Uuid,
  userId: Uuid,
  number: z.number().int().min(1).max(999),
  status: CartStatus,
  label: z.string().nullable(),
  customerName: z.string().nullable(),
  discount: MoneyCents,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CartDto = z.infer<typeof CartDto>;

export const CartItemDto = z.object({
  id: Uuid,
  cartId: Uuid,
  variantId: Uuid,
  sourceRackId: Uuid,
  quantity: Quantity,
  unitPrice: MoneyCents,
  discount: MoneyCents,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CartItemDto = z.infer<typeof CartItemDto>;

export const SaleDto = z.object({
  id: Uuid,
  folio: z.string(),
  branchId: Uuid,
  cashRegisterId: Uuid,
  cashSessionId: Uuid,
  sellerId: Uuid,
  cashierId: Uuid,
  cartId: Uuid,
  customerName: z.string().nullable(),
  subtotal: MoneyCents,
  globalDiscount: MoneyCents,
  discountTotal: MoneyCents,
  taxRateBp: BasisPoints,
  pricesIncludeTax: z.boolean(),
  taxTotal: MoneyCents,
  total: MoneyCents,
  status: SaleStatus,
  cancelledAt: IsoDateTime.nullable(),
  cancelledById: Uuid.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SaleDto = z.infer<typeof SaleDto>;

export const SaleItemDto = z.object({
  id: Uuid,
  saleId: Uuid,
  variantId: Uuid,
  sourceRackId: Uuid,
  skuSnapshot: z.string(),
  nameSnapshot: z.string(),
  variantLabelSnapshot: z.string().nullable(),
  unitPrice: MoneyCents,
  quantity: Quantity,
  discount: MoneyCents,
  lineTotal: MoneyCents,
  createdAt: IsoDateTime,
});
export type SaleItemDto = z.infer<typeof SaleItemDto>;

export const PaymentDto = z.object({
  id: Uuid,
  saleId: Uuid,
  method: PaymentMethod,
  amount: MoneyCents,
  received: MoneyCents.nullable(),
  change: MoneyCents.nullable(),
  reference: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type PaymentDto = z.infer<typeof PaymentDto>;
