import {
  type CheckoutInput,
  computeChange,
  computeSaleTotals,
  formatFolio,
  type SaleTicketDto,
  variantLabel,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, validationError } from '../../core/errors.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { assertInBranch, type PosActor } from './pos.actor.js';
import * as repo from './pos.repository.js';
import { ticketOf } from './sales.service.js';

/** `createdAt` creciente para conservar el orden del carrito y de los pagos en el ticket. */
const stamp = (base: Date, index: number) => new Date(base.getTime() + index);

/** Cobro de un carrito en la caja del dispositivo (spec F8 §3), todo en una transacción. */
export class CheckoutService {
  private readonly inventory = new InventoryService();

  constructor(private readonly app: FastifyInstance) {}

  async checkout(actor: PosActor, cartId: string, input: CheckoutInput): Promise<SaleTicketDto> {
    return this.app.prisma.$transaction(async (tx) => {
      // La venta y su dinero quedan en la caja que cobra; la sesión se bloquea para que un corte
      // simultáneo espere a este cobro (o este cobro vea la caja cerrada).
      const found = await tx.cashSession.findUnique({
        where: { id: input.cashSessionId },
        select: { id: true, cashRegister: { select: { branchId: true } } },
      });
      assertInBranch(actor, found && { branchId: found.cashRegister.branchId });
      await repo.lockSession(tx, input.cashSessionId, 'SHARE');
      const session = await tx.cashSession.findUniqueOrThrow({
        where: { id: input.cashSessionId },
        select: { id: true, status: true, cashRegisterId: true },
      });
      if (session.status !== 'OPEN') throw new DomainError('CASH_SESSION_CLOSED');

      await repo.lockCart(tx, cartId);
      const cart = await tx.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { variant: { include: { product: { select: { name: true } } } } },
          },
        },
      });
      assertInBranch(actor, cart);
      if (!repo.OPEN_CART_STATUSES.includes(cart.status)) {
        throw new DomainError('CART_NOT_EDITABLE');
      }
      if (cart.items.length === 0) throw new DomainError('CART_EMPTY');

      const totalUnits = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      if (input.verifiedUnits > totalUnits) {
        throw validationError(
          'verifiedUnits',
          'Hay más piezas verificadas que piezas en el carrito',
        );
      }

      // La configuración de IVA es la de la sucursal al cobrar (y la venta guarda su copia).
      const branch = await repo.taxSettingsOf(tx, actor.branchId);
      const totals = computeSaleTotals({
        lines: cart.items,
        globalDiscount: cart.discount,
        taxRateBp: branch.taxRateBp,
        pricesIncludeTax: branch.pricesIncludeTax,
      });
      const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
      if (paid !== totals.total) {
        throw new DomainError('PAYMENT_TOTAL_MISMATCH', {
          details: { total: totals.total, paid },
        });
      }

      const folio = formatFolio(branch.code, await repo.nextSaleFolio(tx, actor.branchId));
      const customerName =
        input.customerName !== undefined ? input.customerName : cart.customerName;
      const now = new Date();
      const sale = await tx.sale.create({
        data: {
          folio,
          branchId: actor.branchId,
          cashRegisterId: session.cashRegisterId,
          cashSessionId: session.id,
          sellerId: cart.userId,
          cashierId: actor.userId,
          cartId: cart.id,
          customerName,
          subtotal: totals.subtotal,
          globalDiscount: totals.globalDiscount,
          discountTotal: totals.discountTotal,
          taxRateBp: branch.taxRateBp,
          pricesIncludeTax: branch.pricesIncludeTax,
          taxTotal: totals.taxTotal,
          total: totals.total,
          items: {
            create: cart.items.map((item, i) => ({
              variantId: item.variantId,
              sourceRackId: item.sourceRackId,
              skuSnapshot: item.variant.sku,
              nameSnapshot: item.variant.product.name,
              variantLabelSnapshot: variantLabel(item.variant),
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              discount: item.discount,
              lineTotal: item.unitPrice * item.quantity - item.discount,
              createdAt: stamp(now, i),
            })),
          },
          payments: {
            create: input.payments.map((payment, i) => {
              const cash = payment.method === 'CASH' && payment.received !== undefined;
              return {
                method: payment.method,
                amount: payment.amount,
                received: cash ? payment.received! : null,
                change: cash ? computeChange(payment.received!, payment.amount) : null,
                reference: payment.reference ?? null,
                createdAt: stamp(now, i),
              };
            }),
          },
        },
      });

      for (const item of cart.items) {
        await this.inventory.sell(tx, {
          variantId: item.variantId,
          rackId: item.sourceRackId,
          quantity: item.quantity,
          userId: actor.userId,
          reference: { type: 'SALE', id: sale.id },
        });
      }
      await tx.cart.update({
        where: { id: cart.id },
        data: { status: 'CHECKED_OUT', customerName },
      });

      if (input.verifiedUnits < totalUnits) {
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'pos.checkout.unverified',
            entity: 'Sale',
            entityId: sale.id,
            payload: { saleId: sale.id, folio, verifiedUnits: input.verifiedUnits, totalUnits },
            ip: actor.ip,
          },
          tx,
        );
      }
      return ticketOf(tx, sale.id);
    });
  }
}
