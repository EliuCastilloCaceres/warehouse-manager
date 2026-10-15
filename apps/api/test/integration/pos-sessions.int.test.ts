import type {
  CartDetailDto,
  CashSessionSummaryDto,
  PosRegisterDto,
  PosSessionDto,
} from '@warehouse-manager/shared';
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

describe('cajas del POS', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pos: PosScenario;

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    pos = await setupPos(prisma, app);
  });

  beforeEach(async () => {
    await resetPos(prisma, pos);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lista, abre y no reabre cajas (T5)', async () => {
    const listed = expectStatus<PosRegisterDto[]>(await pos.luis.get('/pos/cash-registers'), 200);
    expect(listed.map((r) => [r.code, r.openSession])).toEqual([
      ['C1', null],
      ['C2', null],
    ]);

    const session = await openSession(pos.luis, pos.registers.S1.C1, 50000);
    expect(session).toMatchObject({
      status: 'OPEN',
      openingAmount: 50000,
      cashRegister: { id: pos.registers.S1.C1, code: 'C1' },
      openedBy: { id: pos.luisId, fullName: 'Luis Mora' },
      closedBy: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'pos.session.open', entityId: session.id },
    });
    expect(audit).toMatchObject({ userId: pos.luisId, entity: 'CashSession' });

    const after = expectStatus<PosRegisterDto[]>(await pos.ana.get('/pos/cash-registers'), 200);
    expect(after[0]!.openSession).toEqual({
      id: session.id,
      openedAt: session.openedAt,
      openedBy: { id: pos.luisId, fullName: 'Luis Mora' },
    });
    expect(after[1]!.openSession).toBeNull();

    const again = await pos.ana.post('/pos/cash-sessions/open', {
      cashRegisterId: pos.registers.S1.C1,
      openingAmount: 0,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('CASH_SESSION_ALREADY_OPEN');

    const otherBranch = await pos.luis.post('/pos/cash-sessions/open', {
      cashRegisterId: pos.registers.S2.C1,
      openingAmount: 0,
    });
    expect(otherBranch.statusCode).toBe(403);
    expect(otherBranch.json().code).toBe('BRANCH_FORBIDDEN');

    const forbidden = await pos.clerk.post('/pos/cash-sessions/open', {
      cashRegisterId: pos.registers.S1.C2,
      openingAmount: 0,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'pos.session.open' },
    });

    expect(
      expectStatus<PosSessionDto>(await pos.ana.get(`/pos/cash-sessions/${session.id}`), 200),
    ).toEqual(session);
  });

  it('corte ciego: esperado, contado, diferencia y desglose (T6)', async () => {
    const c1 = await openSession(pos.luis, pos.registers.S1.C1, 50000);
    const c2 = await openSession(pos.luis, pos.registers.S1.C2, 0);

    // Efectivo: 124800 con recibido 130000.
    const first = await cartWith(pos.ana, [
      [pos.shoe, pos.racks.a1],
      [pos.belt, pos.racks.a2],
    ]);
    expect(first.totals.total).toBe(124800);
    await payCash(pos.luis, first, c1.id, 130000);

    // Mixta: 20000 en efectivo + 30000 con tarjeta (zapato con descuento global de 39900).
    const second = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    expectStatus(await pos.manager.patch(`/pos/carts/${second.id}`, { discount: 39900 }), 200);
    expectStatus(
      await pos.luis.post(`/pos/carts/${second.id}/checkout`, {
        cashSessionId: c1.id,
        payments: [
          { method: 'CASH', amount: 20000 },
          { method: 'CARD', amount: 30000, reference: 'AUT-1' },
        ],
        verifiedUnits: 1,
      }),
      201,
    );

    // Efectivo cancelado: no cuenta en el esperado.
    const third = await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]);
    const cancelled = await payCash(pos.luis, third, c1.id);
    expectStatus(
      await pos.manager.post(`/pos/sales/${cancelled.sale.id}/cancel`, { reason: 'Error' }),
      200,
    );

    const open = await pos.luis.get(`/pos/cash-sessions/${c1.id}/summary`);
    expect(open.statusCode).toBe(409);
    expect(open.json().code).toBe('CONFLICT');

    const summary = expectStatus<CashSessionSummaryDto>(
      await pos.luis.post(`/pos/cash-sessions/${c1.id}/close`, { countedAmount: 194780 }),
      200,
    );
    expect(summary).toMatchObject({
      salesCount: 2,
      salesTotal: 174800,
      cancelledCount: 1,
      cancelledTotal: 34900,
      byMethod: [
        { method: 'CASH', count: 2, amount: 144800 },
        { method: 'CARD', count: 1, amount: 30000 },
        { method: 'TRANSFER', count: 0, amount: 0 },
      ],
      expectedAmount: 50000 + 124800 + 20000,
      countedAmount: 194780,
      difference: -20,
      session: { id: c1.id, status: 'CLOSED', closedBy: { id: pos.luisId } },
    });
    const row = await prisma.cashSession.findUniqueOrThrow({ where: { id: c1.id } });
    expect(row).toMatchObject({
      status: 'CLOSED',
      closedById: pos.luisId,
      expectedAmount: 194800,
      countedAmount: 194780,
      difference: -20,
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'pos.session.close', entityId: c1.id } }),
    ).toBe(1);

    const twice = await pos.luis.post(`/pos/cash-sessions/${c1.id}/close`, { countedAmount: 0 });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('CASH_SESSION_CLOSED');
    expect(
      expectStatus<CashSessionSummaryDto>(
        await pos.ana.get(`/pos/cash-sessions/${c1.id}/summary`),
        200,
      ),
    ).toEqual(summary);

    // Diferencia positiva en la otra caja (sin ventas: el esperado es el fondo).
    const surplus = expectStatus<CashSessionSummaryDto>(
      await pos.luis.post(`/pos/cash-sessions/${c2.id}/close`, { countedAmount: 500 }),
      200,
    );
    expect(surplus).toMatchObject({ expectedAmount: 0, difference: 500, salesCount: 0 });

    for (const res of [
      await pos.clerk.post(`/pos/cash-sessions/${c1.id}/close`, { countedAmount: 0 }),
      await pos.clerk.get(`/pos/cash-sessions/${c1.id}/summary`),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().details).toEqual({ permission: 'pos.session.close' });
    }
  });

  it('la última caja no cierra con carritos pendientes hasta liberarlos (T7)', async () => {
    const c1 = await openSession(pos.luis, pos.registers.S1.C1);
    const c2 = await openSession(pos.luis, pos.registers.S1.C2);
    const anaCart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);
    expectStatus(
      await pos.ana.post(`/pos/carts/${anaCart.id}/suspend`, { label: 'Señora rojo' }),
      200,
    );
    const juanCart = await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]);
    const empty = await cartWith(pos.luis);

    expectStatus(
      await pos.luis.post(`/pos/cash-sessions/${c1.id}/close`, { countedAmount: 50000 }),
      200,
    );
    const unchanged = await prisma.cart.findMany({
      where: { id: { in: [anaCart.id, juanCart.id, empty.id] } },
      orderBy: { number: 'asc' },
    });
    expect(unchanged.map((c) => c.status)).toEqual(['SUSPENDED', 'ACTIVE', 'ACTIVE']);

    const blocked = await pos.luis.post(`/pos/cash-sessions/${c2.id}/close`, { countedAmount: 0 });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('CASH_SESSION_HAS_OPEN_CARTS');
    expect(blocked.json().details.carts).toEqual([
      expect.objectContaining({
        id: anaCart.id,
        number: anaCart.number,
        owner: { id: pos.anaId, fullName: 'Ana López' },
        label: 'Señora rojo',
        unitCount: 2,
      }),
      expect.objectContaining({ id: juanCart.id, unitCount: 1 }),
    ]);

    const released = expectStatus<{ releasedCarts: number }>(
      await pos.luis.post('/pos/carts/release-all', { releaseTo: 'RACK' }),
      200,
    );
    expect(released).toEqual({ releasedCarts: 2 });
    for (const id of [anaCart.id, juanCart.id]) {
      expect(expectStatus<CartDetailDto>(await pos.luis.get(`/pos/carts/${id}`), 200).status).toBe(
        'DISCARDED',
      );
    }
    expect(
      await prisma.inventoryMovement.count({
        where: { type: 'RETURN_TO_RACK', referenceId: { in: [anaCart.id, juanCart.id] } },
      }),
    ).toBe(2);
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 10, reservedQty: 0 });
    expect(await stockOf(prisma, pos.belt, pos.racks.a2)).toEqual({ quantity: 10, reservedQty: 0 });
    expect(await prisma.auditLog.count({ where: { action: 'pos.carts.release_all' } })).toBe(1);

    expectStatus(
      await pos.luis.post(`/pos/cash-sessions/${c2.id}/close`, { countedAmount: 50000 }),
      200,
    );
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe(
      'DISCARDED',
    );
  });

  it('liberar todo a staging (T7)', async () => {
    await openSession(pos.luis, pos.registers.S1.C1);
    const cart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);

    expectStatus(await pos.luis.post('/pos/carts/release-all', { releaseTo: 'STAGING' }), 200);
    const moves = await prisma.inventoryMovement.findMany({
      where: { referenceId: cart.id, type: 'TO_STAGING' },
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      quantity: 2,
      fromRackId: pos.racks.a1,
      toRackId: pos.racks.staging,
    });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 8, reservedQty: 0 });
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 5,
      reservedQty: 0,
    });

    // Sin pendientes no hay nada que liberar ni que auditar otra vez.
    expect(
      expectStatus(await pos.luis.post('/pos/carts/release-all', { releaseTo: 'RACK' }), 200),
    ).toEqual({ releasedCarts: 0 });
    expect(await prisma.auditLog.count({ where: { action: 'pos.carts.release_all' } })).toBe(1);
    const forbidden = await pos.clerk.post('/pos/carts/release-all', { releaseTo: 'RACK' });
    expect(forbidden.statusCode).toBe(403);
  });
});
