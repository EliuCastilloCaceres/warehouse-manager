import type { SaleListItemDto, SaleTicketDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createTestClient } from './helpers/db.js';
import {
  cartWith,
  expectStatus,
  openSession,
  payCash,
  type PosScenario,
  resetPos,
  setupPos,
  stockOf,
} from './helpers/pos.js';

type SalePage = { items: SaleListItemDto[]; page: number; pageSize: number; total: number };

describe('ventas: ticket, historial y cancelación', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pos: PosScenario;
  let c1: string;

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    pos = await setupPos(prisma, app);
  });

  beforeEach(async () => {
    await resetPos(prisma, pos);
    c1 = (await openSession(pos.luis, pos.registers.S1.C1)).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('ticket e historial de la caja según quién vendió o cobró (T18)', async () => {
    // 1: Ana vende y Luis cobra; 2: Juan vende y Luis cobra; 3: Juan vende y cobra.
    const one = await payCash(pos.luis, await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]), c1);
    const two = await payCash(pos.luis, await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]), c1);
    const three = await payCash(pos.juan, await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]), c1);

    expect(
      expectStatus<SaleTicketDto>(await pos.ana.get(`/pos/sales/${one.sale.id}/ticket`), 200),
    ).toEqual(one);

    const s2Session = await openSession(pos.managerS2, pos.registers.S2.C1);
    const s2Sale = await payCash(
      pos.managerS2,
      await cartWith(pos.managerS2, [[pos.shoe, pos.racks.b1]]),
      s2Session.id,
    );
    const foreign = await pos.ana.get(`/pos/sales/${s2Sale.sale.id}/ticket`);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().code).toBe('BRANCH_FORBIDDEN');
    const foreignHistory = await pos.ana.get(`/pos/cash-sessions/${s2Session.id}/sales`);
    expect(foreignHistory.statusCode).toBe(403);

    const folios = async (api: typeof pos.ana, query = '') =>
      expectStatus<SalePage>(await api.get(`/pos/cash-sessions/${c1}/sales${query}`), 200);
    expect((await folios(pos.ana)).items.map((s) => s.id)).toEqual([one.sale.id]);
    expect((await folios(pos.juan)).items.map((s) => s.id)).toEqual([three.sale.id, two.sale.id]);
    expect((await folios(pos.luis)).items.map((s) => s.id)).toEqual([two.sale.id, one.sale.id]);
    const all = await folios(pos.manager);
    expect(all.items.map((s) => s.id)).toEqual([three.sale.id, two.sale.id, one.sale.id]);
    expect(all.items[2]).toEqual({
      id: one.sale.id,
      folio: 'S1-000001',
      createdAt: one.sale.createdAt,
      total: 89900,
      status: 'COMPLETED',
      customerName: null,
      seller: { id: pos.anaId, fullName: 'Ana López' },
      cashier: { id: pos.luisId, fullName: 'Luis Mora' },
      methods: ['CASH'],
    });

    const page2 = await folios(pos.manager, '?page=2&pageSize=2');
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.items.map((s) => s.id)).toEqual([one.sale.id]);
    expect((await folios(pos.manager, '?q=000002')).items.map((s) => s.id)).toEqual([two.sale.id]);
  });

  it('cancelar regresa el stock a staging y exige la caja abierta (T19)', async () => {
    const ticket = await payCash(
      pos.luis,
      await cartWith(pos.ana, [
        [pos.shoe, pos.racks.a1, 2],
        [pos.belt, pos.racks.a2],
      ]),
      c1,
    );
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 8, reservedQty: 0 });

    const forbidden = await pos.ana.post(`/pos/sales/${ticket.sale.id}/cancel`, {
      reason: 'Error',
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().details).toEqual({ permission: 'pos.sale.cancel' });
    const noReason = await pos.manager.post(`/pos/sales/${ticket.sale.id}/cancel`, {
      reason: '  ',
    });
    expect(noReason.statusCode).toBe(400);

    const cancelled = expectStatus<SaleTicketDto>(
      await pos.manager.post(`/pos/sales/${ticket.sale.id}/cancel`, {
        reason: ' Cliente se arrepintió ',
      }),
      200,
    );
    expect(cancelled.sale).toMatchObject({
      status: 'CANCELLED',
      cancelledById: pos.managerId,
      cancelReason: 'Cliente se arrepintió',
    });
    expect(cancelled.sale.cancelledAt).not.toBeNull();
    expect(cancelled.cancelledBy).toEqual({ id: pos.managerId, fullName: 'Gerente S1' });

    const moves = await prisma.inventoryMovement.findMany({
      where: { type: 'SALE_CANCEL' },
      orderBy: { quantity: 'desc' },
    });
    expect(moves.map((m) => [m.variantId, m.quantity, m.toRackId, m.referenceId])).toEqual([
      [pos.shoe, 2, pos.racks.staging, ticket.sale.id],
      [pos.belt, 1, pos.racks.staging, ticket.sale.id],
    ]);
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 8, reservedQty: 0 });
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 5,
      reservedQty: 0,
    });
    expect(await stockOf(prisma, pos.belt, pos.racks.staging)).toEqual({
      quantity: 1,
      reservedQty: 0,
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: 'pos.sale.cancel' } }),
    ).toMatchObject({
      entity: 'Sale',
      entityId: ticket.sale.id,
      userId: pos.managerId,
      payload: expect.objectContaining({ folio: 'S1-000001', reason: 'Cliente se arrepintió' }),
    });

    const twice = await pos.manager.post(`/pos/sales/${ticket.sale.id}/cancel`, {
      reason: 'Otra vez',
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('SALE_ALREADY_CANCELLED');

    // Con la caja donde se cobró ya cerrada no se cancela.
    const later = await payCash(pos.luis, await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]), c1);
    expectStatus(await pos.luis.post(`/pos/cash-sessions/${c1}/close`, { countedAmount: 0 }), 200);
    const closed = await pos.manager.post(`/pos/sales/${later.sale.id}/cancel`, {
      reason: 'Tarde',
    });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe('CASH_SESSION_CLOSED');
  });
});
