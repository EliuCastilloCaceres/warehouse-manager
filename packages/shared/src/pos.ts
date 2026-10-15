import { z } from 'zod';
import { BasisPoints, IsoDateTime, NonNegativeInt, Quantity, Uuid } from './common.js';
import { BranchDto, CashRegisterDto, CashSessionDto } from './dto/organization.js';
import { CartDto, CartItemDto, PaymentDto, SaleDto, SaleItemDto } from './dto/pos.js';
import { PaymentMethod, SaleStatus } from './enums.js';
import { applyBasisPoints, MoneyCents, SignedMoneyCents } from './money.js';

/** Carritos suspendidos por vendedor y sucursal (spec F8 §2), además del activo. */
export const MAX_SUSPENDED_CARTS_PER_USER = 5;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

/** A dónde va una pieza que sale del carrito: a su ubicación o al staging del almacén. */
export const ReleaseTo = z.enum(['RACK', 'STAGING']);
export type ReleaseTo = z.infer<typeof ReleaseTo>;

/** `('S1', 123)` → `'S1-000123'`; con más de 6 dígitos, el número completo. */
export function formatFolio(branchCode: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`Se esperaba un entero ≥ 1 y se recibió ${n}`);
  }
  return `${branchCode}-${String(n).padStart(6, '0')}`;
}

function assertAmount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what}: se esperaba un entero ≥ 0 y se recibió ${value}`);
  }
}

export type SaleLineInput = { unitPrice: number; quantity: number; discount: number };

export interface SaleTotals {
  subtotal: number;
  lineDiscounts: number;
  globalDiscount: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * Totales de una venta en centavos (spec F8 §3): el IVA se calcula una vez sobre el total
 * después de descuentos, con redondeo a medio hacia arriba y aritmética entera.
 * - IVA incluido: `total = subtotal − descuentos` e `IVA = total − round(total × 10000 ÷ (10000 + bp))`.
 * - Sin IVA: `IVA = applyBasisPoints(subtotal − descuentos, bp)` y `total = subtotal − descuentos + IVA`.
 *
 * Lanza `RangeError` si un monto no es entero ≥ 0, si un descuento de partida supera su importe
 * o si el global supera Σ(unitPrice × quantity − discount).
 */
export function computeSaleTotals(input: {
  lines: readonly SaleLineInput[];
  globalDiscount: number;
  taxRateBp: number;
  pricesIncludeTax: boolean;
}): SaleTotals {
  assertAmount(input.globalDiscount, 'globalDiscount');
  assertAmount(input.taxRateBp, 'taxRateBp');
  let subtotal = 0;
  let lineDiscounts = 0;
  for (const line of input.lines) {
    assertAmount(line.unitPrice, 'unitPrice');
    assertAmount(line.quantity, 'quantity');
    assertAmount(line.discount, 'discount');
    const amount = line.unitPrice * line.quantity;
    assertAmount(amount, 'importe');
    if (line.discount > amount) {
      throw new RangeError('El descuento de una partida supera su importe');
    }
    subtotal += amount;
    lineDiscounts += line.discount;
  }
  if (input.globalDiscount > subtotal - lineDiscounts) {
    throw new RangeError('El descuento global supera el importe de las partidas');
  }
  const discountTotal = lineDiscounts + input.globalDiscount;
  const base = subtotal - discountTotal;
  if (input.pricesIncludeTax) {
    const divisor = BigInt(10000 + input.taxRateBp);
    const net = Number((BigInt(base) * 10000n + divisor / 2n) / divisor);
    return {
      subtotal,
      lineDiscounts,
      globalDiscount: input.globalDiscount,
      discountTotal,
      taxTotal: base - net,
      total: base,
    };
  }
  const taxTotal = applyBasisPoints(base, input.taxRateBp);
  return {
    subtotal,
    lineDiscounts,
    globalDiscount: input.globalDiscount,
    discountTotal,
    taxTotal,
    total: base + taxTotal,
  };
}

/** Cambio del efectivo: `received − amount`; `RangeError` si lo recibido no alcanza. */
export function computeChange(received: number, amount: number): number {
  assertAmount(received, 'received');
  assertAmount(amount, 'amount');
  if (received < amount) throw new RangeError('El efectivo recibido no alcanza');
  return received - amount;
}

const UserRef = z.object({ id: Uuid, fullName: z.string() });
export type UserRef = z.infer<typeof UserRef>;

/** Texto opcional: se recorta y la cadena vacía se guarda como `null`. */
const optionalName = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// ─── Caja ────────────────────────────────────────────────────────────────────

export const OpenSessionInput = z.object({ cashRegisterId: Uuid, openingAmount: MoneyCents });
export type OpenSessionInput = z.infer<typeof OpenSessionInput>;

export const CloseSessionInput = z.object({ countedAmount: MoneyCents });
export type CloseSessionInput = z.infer<typeof CloseSessionInput>;

export const ReleaseCartsInput = z.object({ releaseTo: ReleaseTo });
export type ReleaseCartsInput = z.infer<typeof ReleaseCartsInput>;

export const ReleaseCartsResultDto = z.object({ releasedCarts: NonNegativeInt });
export type ReleaseCartsResultDto = z.infer<typeof ReleaseCartsResultDto>;

export const PosSessionDto = CashSessionDto.extend({
  cashRegister: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  openedBy: UserRef,
  closedBy: UserRef.nullable(),
});
export type PosSessionDto = z.infer<typeof PosSessionDto>;

export const PosRegisterDto = CashRegisterDto.extend({
  openSession: z.object({ id: Uuid, openedAt: IsoDateTime, openedBy: UserRef }).nullable(),
});
export type PosRegisterDto = z.infer<typeof PosRegisterDto>;

export const CashSessionSummaryDto = z.object({
  session: PosSessionDto,
  salesCount: NonNegativeInt,
  salesTotal: MoneyCents,
  cancelledCount: NonNegativeInt,
  cancelledTotal: MoneyCents,
  // Los 3 métodos, siempre (con 0 si no hubo pagos de ese método).
  byMethod: z.array(z.object({ method: PaymentMethod, count: NonNegativeInt, amount: MoneyCents })),
  expectedAmount: MoneyCents,
  countedAmount: MoneyCents,
  difference: SignedMoneyCents,
});
export type CashSessionSummaryDto = z.infer<typeof CashSessionSummaryDto>;

// ─── Carritos ────────────────────────────────────────────────────────────────

export const CartCreateInput = z.object({
  label: optionalName(60).optional(),
  customerName: optionalName(120).optional(),
});
export type CartCreateInput = z.infer<typeof CartCreateInput>;

export const CartUpdateInput = z
  .strictObject({
    label: optionalName(60).optional(),
    customerName: optionalName(120).optional(),
    discount: MoneyCents.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });
export type CartUpdateInput = z.infer<typeof CartUpdateInput>;

export const CartSuspendInput = z.object({
  label: optionalName(60).optional(),
  customerName: optionalName(120).optional(),
});
export type CartSuspendInput = z.infer<typeof CartSuspendInput>;

export const CartDiscardInput = z.object({ releaseTo: ReleaseTo });
export type CartDiscardInput = z.infer<typeof CartDiscardInput>;

export const CartItemAddInput = z.object({
  variantId: Uuid,
  sourceRackId: Uuid,
  quantity: Quantity,
});
export type CartItemAddInput = z.infer<typeof CartItemAddInput>;

export const CartItemUpdateInput = z
  .strictObject({
    quantity: Quantity.optional(),
    discount: MoneyCents.optional(),
    releaseTo: ReleaseTo.default('RACK'),
  })
  .refine((v) => v.quantity !== undefined || v.discount !== undefined, {
    message: 'Indica la cantidad o el descuento',
  });
export type CartItemUpdateInput = z.infer<typeof CartItemUpdateInput>;

/** Query de `DELETE /pos/carts/:id/items/:itemId`. */
export const CartItemRemoveQuery = z.object({ releaseTo: ReleaseTo.default('RACK') });
export type CartItemRemoveQuery = z.infer<typeof CartItemRemoveQuery>;

export const CartListQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  number: z.coerce.number().int().min(1).max(999).optional(), // buscar "Carrito #12"
});
export type CartListQuery = z.infer<typeof CartListQuery>;

export const SaleTotalsDto = z.object({
  subtotal: MoneyCents,
  lineDiscounts: MoneyCents,
  globalDiscount: MoneyCents,
  discountTotal: MoneyCents,
  taxTotal: MoneyCents,
  total: MoneyCents,
  taxRateBp: BasisPoints,
  pricesIncludeTax: z.boolean(),
});
export type SaleTotalsDto = z.infer<typeof SaleTotalsDto>;

export const CartItemRowDto = CartItemDto.extend({
  sku: z.string(),
  barcode: z.string().nullable(), // para la verificación en caja
  productName: z.string(),
  variantLabel: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  locationCode: z.string(),
  isStaging: z.boolean(),
  lineTotal: MoneyCents,
});
export type CartItemRowDto = z.infer<typeof CartItemRowDto>;

export const CartDetailDto = CartDto.extend({
  owner: UserRef,
  items: z.array(CartItemRowDto),
  totals: SaleTotalsDto,
});
export type CartDetailDto = z.infer<typeof CartDetailDto>;

export const CartSummaryDto = CartDto.extend({
  owner: UserRef,
  itemCount: NonNegativeInt,
  unitCount: NonNegativeInt,
  total: MoneyCents,
});
export type CartSummaryDto = z.infer<typeof CartSummaryDto>;

// ─── Cobro y ventas ──────────────────────────────────────────────────────────

export const PaymentInput = z
  .object({
    method: PaymentMethod,
    amount: MoneyCents.refine((v) => v > 0, 'El monto debe ser mayor que 0'),
    received: MoneyCents.optional(),
    reference: z.string().trim().min(1).max(60).optional(),
  })
  .refine((p) => p.received === undefined || (p.method === 'CASH' && p.received >= p.amount), {
    path: ['received'],
    message: 'El efectivo recibido no alcanza',
  })
  .refine((p) => p.method !== 'CASH' || p.reference === undefined, {
    path: ['reference'],
    message: 'El efectivo no lleva referencia',
  });
export type PaymentInput = z.infer<typeof PaymentInput>;

export const CheckoutInput = z
  .object({
    cashSessionId: Uuid, // la caja abierta del dispositivo que cobra
    payments: z.array(PaymentInput).max(3),
    customerName: optionalName(120).optional(),
    verifiedUnits: NonNegativeInt, // piezas verificadas por escaneo en caja (0 = sin verificar)
  })
  .superRefine((input, ctx) => {
    const seen = new Set<PaymentMethod>();
    input.payments.forEach((payment, i) => {
      if (seen.has(payment.method)) {
        ctx.addIssue({
          code: 'custom',
          path: ['payments', i, 'method'],
          message: 'Solo puede haber un pago por método',
        });
      }
      seen.add(payment.method);
    });
  });
export type CheckoutInput = z.infer<typeof CheckoutInput>;

export const TicketBranchDto = BranchDto.pick({
  code: true,
  name: true,
  legalName: true,
  taxId: true,
  address: true,
  phone: true,
  logoUrl: true,
  ticketHeader: true,
  ticketFooterMessage: true,
  promoQrText: true,
  promoQrCaption: true,
  timezone: true,
  currency: true,
});
export type TicketBranchDto = z.infer<typeof TicketBranchDto>;

export const SaleTicketDto = z.object({
  sale: SaleDto,
  items: z.array(SaleItemDto),
  payments: z.array(PaymentDto),
  branch: TicketBranchDto,
  cashRegister: z.object({ code: z.string(), name: z.string() }),
  seller: UserRef,
  cashier: UserRef,
  cancelledBy: UserRef.nullable(),
});
export type SaleTicketDto = z.infer<typeof SaleTicketDto>;

export const SaleListItemDto = z.object({
  id: Uuid,
  folio: z.string(),
  createdAt: IsoDateTime,
  total: MoneyCents,
  status: SaleStatus,
  customerName: z.string().nullable(),
  seller: UserRef,
  cashier: UserRef,
  methods: z.array(PaymentMethod),
});
export type SaleListItemDto = z.infer<typeof SaleListItemDto>;

export const SaleCancelInput = z.object({
  reason: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(300),
});
export type SaleCancelInput = z.infer<typeof SaleCancelInput>;
