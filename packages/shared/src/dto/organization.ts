import { z } from 'zod';
import { BasisPoints, IsoDateTime, NonNegativeInt, Uuid } from '../common.js';
import { CashSessionStatus } from '../enums.js';
import { MoneyCents, SignedMoneyCents } from '../money.js';

export const BranchDto = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  imageUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  ticketHeader: z.string().nullable(),
  ticketFooterMessage: z.string().nullable(),
  promoQrText: z.string().nullable(),
  promoQrCaption: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  taxRateBp: BasisPoints,
  pricesIncludeTax: z.boolean(),
  lowStockThreshold: NonNegativeInt,
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BranchDto = z.infer<typeof BranchDto>;

export const CashRegisterDto = z.object({
  id: Uuid,
  branchId: Uuid,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CashRegisterDto = z.infer<typeof CashRegisterDto>;

export const CashSessionDto = z.object({
  id: Uuid,
  cashRegisterId: Uuid,
  openedById: Uuid,
  openedAt: IsoDateTime,
  openingAmount: MoneyCents,
  closedById: Uuid.nullable(),
  closedAt: IsoDateTime.nullable(),
  expectedAmount: MoneyCents.nullable(),
  countedAmount: MoneyCents.nullable(),
  difference: SignedMoneyCents.nullable(),
  status: CashSessionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CashSessionDto = z.infer<typeof CashSessionDto>;
