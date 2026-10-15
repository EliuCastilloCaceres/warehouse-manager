import type { SaleCancelInput, SaleTicketDto, TicketBranchDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { assertInBranch, type PosActor, userRef } from './pos.actor.js';
import * as repo from './pos.repository.js';

type Db = PrismaClient | Prisma.TransactionClient;

const ticketBranchSelect = {
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
} satisfies Prisma.BranchSelect;

/** Datos **actuales** de ticket de la sucursal (spec F8 §3): no exigen `settings.branch`. */
export function ticketBranchOf(db: Db, branchId: string): Promise<TicketBranchDto> {
  return db.branch.findUniqueOrThrow({ where: { id: branchId }, select: ticketBranchSelect });
}

const user = { select: { id: true, fullName: true } } as const;

/** Venta con todo lo que lleva su ticket. */
export async function ticketOf(db: Db, saleId: string): Promise<SaleTicketDto> {
  const sale = await db.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      branch: { select: ticketBranchSelect },
      cashRegister: { select: { code: true, name: true } },
      seller: user,
      cashier: user,
      cancelledBy: user,
    },
  });
  const { items, payments, branch, cashRegister, seller, cashier, cancelledBy, ...row } = sale;
  return {
    sale: {
      ...row,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    payments: payments.map((payment) => ({
      ...payment,
      createdAt: payment.createdAt.toISOString(),
    })),
    branch,
    cashRegister,
    seller: userRef(seller),
    cashier: userRef(cashier),
    cancelledBy: cancelledBy ? userRef(cancelledBy) : null,
  };
}

/** Ticket y cancelación de ventas (spec F8 §3). */
export class SalesService {
  private readonly inventory = new InventoryService();

  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async ticket(actor: PosActor, saleId: string): Promise<SaleTicketDto> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: { branchId: true },
    });
    assertInBranch(actor, sale);
    return ticketOf(this.prisma, saleId);
  }

  /**
   * Cancelación total mientras siga abierta la caja donde se cobró: cada partida regresa al
   * staging del almacén de su rack de origen y el efectivo deja de contar en el corte.
   */
  async cancel(actor: PosActor, saleId: string, input: SaleCancelInput): Promise<SaleTicketDto> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.sale.findUnique({
        where: { id: saleId },
        select: { branchId: true, cashSessionId: true },
      });
      assertInBranch(actor, found);
      await repo.lockSession(tx, found.cashSessionId, 'SHARE');
      await repo.lockSale(tx, saleId);
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: {
          cashSession: { select: { status: true } },
          items: { include: { sourceRack: { select: { warehouseId: true } } } },
        },
      });
      if (sale.cashSession.status !== 'OPEN') throw new DomainError('CASH_SESSION_CLOSED');
      if (sale.status !== 'COMPLETED') throw new DomainError('SALE_ALREADY_CANCELLED');

      for (const item of sale.items) {
        await this.inventory.returnCancelledSaleToStaging(tx, {
          variantId: item.variantId,
          warehouseId: item.sourceRack.warehouseId,
          quantity: item.quantity,
          userId: actor.userId,
          reference: { type: 'SALE', id: sale.id },
        });
      }
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: actor.userId,
          cancelReason: input.reason,
        },
      });
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'pos.sale.cancel',
          entity: 'Sale',
          entityId: sale.id,
          payload: { folio: sale.folio, total: sale.total, reason: input.reason },
          ip: actor.ip,
        },
        tx,
      );
      return ticketOf(tx, sale.id);
    });
  }
}
