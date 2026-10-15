import {
  type CashSessionSummaryDto,
  type CloseSessionInput,
  type OpenSessionInput,
  type PaginationQuery,
  PaymentMethod,
  type PosRegisterDto,
  type PosSessionDto,
  type SaleListItemDto,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, validationError } from '../../core/errors.js';
import { buildPage, toPrismaPage } from '../../core/pagination.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { assertInBranch, type PosActor, userRef } from './pos.actor.js';
import * as repo from './pos.repository.js';

type Db = PrismaClient | Prisma.TransactionClient;

const sessionInclude = {
  cashRegister: { select: { id: true, code: true, name: true, branchId: true } },
  openedBy: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CashSessionInclude;

type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

function toSessionDto({ cashRegister, openedBy, closedBy, ...row }: SessionRow): PosSessionDto {
  return {
    ...row,
    openedAt: row.openedAt.toISOString(),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cashRegister: { id: cashRegister.id, code: cashRegister.code, name: cashRegister.name },
    openedBy: userRef(openedBy),
    closedBy: closedBy ? userRef(closedBy) : null,
  };
}

/** Pendientes que impiden cerrar la última caja (`details.carts` de `CASH_SESSION_HAS_OPEN_CARTS`). */
async function pendingCarts(tx: Prisma.TransactionClient, branchId: string) {
  const carts = await tx.cart.findMany({
    where: { branchId, status: { in: repo.OPEN_CART_STATUSES } },
    orderBy: { number: 'asc' },
    include: {
      user: { select: { id: true, fullName: true } },
      items: { select: { quantity: true } },
    },
  });
  return carts.map((cart) => ({
    id: cart.id,
    number: cart.number,
    owner: userRef(cart.user),
    label: cart.label,
    customerName: cart.customerName,
    unitCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
  }));
}

/** Cajas, sesiones, historial y corte ciego (spec F8 §3). */
export class SessionsService {
  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  /** Cajas activas de la sucursal, por código, con su sesión abierta (si hay). */
  async listRegisters(branchId: string): Promise<PosRegisterDto[]> {
    const registers = await this.prisma.cashRegister.findMany({
      where: { branchId, isActive: true },
      orderBy: { code: 'asc' },
      include: {
        sessions: {
          where: { status: 'OPEN' },
          take: 1,
          include: { openedBy: { select: { id: true, fullName: true } } },
        },
      },
    });
    return registers.map(({ sessions, ...register }) => {
      const open = sessions[0];
      return {
        ...register,
        createdAt: register.createdAt.toISOString(),
        updatedAt: register.updatedAt.toISOString(),
        openSession: open
          ? { id: open.id, openedAt: open.openedAt.toISOString(), openedBy: userRef(open.openedBy) }
          : null,
      };
    });
  }

  async open(actor: PosActor, input: OpenSessionInput): Promise<PosSessionDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await repo.lockBranch(tx, actor.branchId, 'SHARE');
        const register = await tx.cashRegister.findUnique({ where: { id: input.cashRegisterId } });
        assertInBranch(actor, register);
        if (!register.isActive) {
          throw validationError('cashRegisterId', 'La caja está desactivada');
        }
        const open = await tx.cashSession.findFirst({
          where: { cashRegisterId: register.id, status: 'OPEN' },
          select: { id: true },
        });
        if (open) throw new DomainError('CASH_SESSION_ALREADY_OPEN');
        const session = await tx.cashSession.create({
          data: {
            cashRegisterId: register.id,
            openedById: actor.userId,
            openingAmount: input.openingAmount,
          },
          include: sessionInclude,
        });
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'pos.session.open',
            entity: 'CashSession',
            entityId: session.id,
            payload: {
              cashRegisterId: register.id,
              cashRegisterCode: register.code,
              openingAmount: input.openingAmount,
            },
            ip: actor.ip,
          },
          tx,
        );
        return toSessionDto(session);
      });
    } catch (error) {
      // Dos aperturas simultáneas: el índice `cash_session_one_open_per_register` frena la segunda.
      if (repo.isUniqueViolation(error)) throw new DomainError('CASH_SESSION_ALREADY_OPEN');
      throw error;
    }
  }

  private async loadSession(db: Db, actor: PosActor, id: string) {
    const session = await db.cashSession.findUnique({ where: { id }, include: sessionInclude });
    assertInBranch(actor, session && { ...session, branchId: session.cashRegister.branchId });
    return session!;
  }

  async get(actor: PosActor, id: string): Promise<PosSessionDto> {
    return toSessionDto(await this.loadSession(this.prisma, actor, id));
  }

  /**
   * Ventas cobradas en la sesión, de la más reciente a la más antigua. Sin
   * `reports.sales.all_users`, solo las que el usuario vendió o cobró (como el reporte de F9).
   */
  async sales(
    actor: PosActor,
    id: string,
    query: PaginationQuery,
  ): Promise<{ items: SaleListItemDto[]; page: number; pageSize: number; total: number }> {
    await this.loadSession(this.prisma, actor, id);
    const where: Prisma.SaleWhereInput = { cashSessionId: id };
    if (!actor.permissions.includes('reports.sales.all_users')) {
      where.OR = [{ sellerId: actor.userId }, { cashierId: actor.userId }];
    }
    if (query.q) where.folio = { contains: query.q, mode: 'insensitive' };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toPrismaPage(query),
        include: {
          seller: { select: { id: true, fullName: true } },
          cashier: { select: { id: true, fullName: true } },
          payments: { select: { method: true } },
        },
      }),
    ]);
    const items = rows.map((sale): SaleListItemDto => ({
      id: sale.id,
      folio: sale.folio,
      createdAt: sale.createdAt.toISOString(),
      total: sale.total,
      status: sale.status,
      customerName: sale.customerName,
      seller: userRef(sale.seller),
      cashier: userRef(sale.cashier),
      methods: PaymentMethod.options.filter((m) => sale.payments.some((p) => p.method === m)),
    }));
    return buildPage(items, total, query);
  }

  /**
   * Corte ciego: solo recibe lo contado. Si es la última caja abierta de la sucursal, los
   * carritos con partidas lo impiden (`CASH_SESSION_HAS_OPEN_CARTS`) y los vacíos se descartan.
   */
  async close(actor: PosActor, id: string, input: CloseSessionInput) {
    return this.prisma.$transaction(async (tx) => {
      await repo.lockBranch(tx, actor.branchId, 'UPDATE');
      await this.loadSession(tx, actor, id);
      await repo.lockSession(tx, id, 'UPDATE');
      const session = await this.loadSession(tx, actor, id);
      if (session.status !== 'OPEN') throw new DomainError('CASH_SESSION_CLOSED');

      if ((await repo.countOpenSessions(tx, actor.branchId, id)) === 0) {
        const carts = await pendingCarts(tx, actor.branchId);
        const withItems = carts.filter((cart) => cart.unitCount > 0);
        if (withItems.length > 0) {
          throw new DomainError('CASH_SESSION_HAS_OPEN_CARTS', { details: { carts: withItems } });
        }
        if (carts.length > 0) {
          await tx.cart.updateMany({
            where: { id: { in: carts.map((cart) => cart.id) } },
            data: { status: 'DISCARDED' },
          });
        }
      }

      const expectedAmount = session.openingAmount + (await this.cashCollected(tx, id));
      const difference = input.countedAmount - expectedAmount;
      const closed = await tx.cashSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedById: actor.userId,
          closedAt: new Date(),
          expectedAmount,
          countedAmount: input.countedAmount,
          difference,
        },
        include: sessionInclude,
      });
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'pos.session.close',
          entity: 'CashSession',
          entityId: id,
          payload: {
            cashRegisterCode: closed.cashRegister.code,
            expectedAmount,
            countedAmount: input.countedAmount,
            difference,
          },
          ip: actor.ip,
        },
        tx,
      );
      return this.summaryOf(tx, closed);
    });
  }

  /** El resumen (esperado y diferencia) solo se consulta con la sesión cerrada. */
  async summary(actor: PosActor, id: string): Promise<CashSessionSummaryDto> {
    const session = await this.loadSession(this.prisma, actor, id);
    if (session.status === 'OPEN') {
      throw new DomainError('CONFLICT', {
        message: 'La caja sigue abierta; el resumen se ve después del corte.',
      });
    }
    return this.summaryOf(this.prisma, session);
  }

  /** Σ del efectivo cobrado en ventas `COMPLETED` de la sesión (ya sin el cambio entregado). */
  private async cashCollected(db: Db, sessionId: string): Promise<number> {
    const { _sum } = await db.payment.aggregate({
      where: { method: 'CASH', sale: { cashSessionId: sessionId, status: 'COMPLETED' } },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }

  private async summaryOf(db: Db, session: SessionRow): Promise<CashSessionSummaryDto> {
    const [byStatus, byMethod] = await Promise.all([
      db.sale.groupBy({
        by: ['status'],
        where: { cashSessionId: session.id },
        _count: { _all: true },
        _sum: { total: true },
      }),
      db.payment.groupBy({
        by: ['method'],
        where: { sale: { cashSessionId: session.id, status: 'COMPLETED' } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const status = (s: 'COMPLETED' | 'CANCELLED') => byStatus.find((row) => row.status === s);
    return {
      session: toSessionDto(session),
      salesCount: status('COMPLETED')?._count._all ?? 0,
      salesTotal: status('COMPLETED')?._sum.total ?? 0,
      cancelledCount: status('CANCELLED')?._count._all ?? 0,
      cancelledTotal: status('CANCELLED')?._sum.total ?? 0,
      byMethod: PaymentMethod.options.map((method) => {
        const row = byMethod.find((r) => r.method === method);
        return { method, count: row?._count._all ?? 0, amount: row?._sum.amount ?? 0 };
      }),
      expectedAmount: session.expectedAmount ?? 0,
      countedAmount: session.countedAmount ?? 0,
      difference: session.difference ?? 0,
    };
  }
}
