import type { PrismaClient } from '../../../src/core/prisma-client.js';

export interface SaleFixtureOptions {
  /** Código de sucursal del seed base (por defecto `S1`) y caja (por defecto `C1`). */
  branchCode?: string;
  registerCode?: string;
  userId: string;
  taxRateBp?: number;
  pricesIncludeTax?: boolean;
}

let folio = 0;

/**
 * Venta guardada mínima (sesión de caja abierta, carrito cobrado y venta), con la copia de IVA
 * que hace cada venta (F1 §4.6). Requiere el seed base.
 */
export async function createSaleFixture(
  prisma: PrismaClient,
  {
    branchCode = 'S1',
    registerCode = 'C1',
    userId,
    taxRateBp = 1600,
    pricesIncludeTax = true,
  }: SaleFixtureOptions,
) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: branchCode } });
  const register = await prisma.cashRegister.findUniqueOrThrow({
    where: { branchId_code: { branchId: branch.id, code: registerCode } },
  });
  const session = await prisma.cashSession.create({
    data: { cashRegisterId: register.id, openedById: userId, openingAmount: 50000 },
  });
  const cart = await prisma.cart.create({
    data: { branchId: branch.id, userId, number: 1, status: 'CHECKED_OUT' },
  });
  return prisma.sale.create({
    data: {
      folio: `${branchCode}-${String(++folio).padStart(6, '0')}`,
      branchId: branch.id,
      cashRegisterId: register.id,
      cashSessionId: session.id,
      sellerId: userId,
      cashierId: userId,
      cartId: cart.id,
      subtotal: 89900,
      discountTotal: 0,
      taxRateBp,
      pricesIncludeTax,
      taxTotal: 12400,
      total: 89900,
    },
  });
}
