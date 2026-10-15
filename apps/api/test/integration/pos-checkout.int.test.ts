import type {
  CartDetailDto,
  CashSessionSummaryDto,
  SaleListItemDto,
  SaleTicketDto,
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

describe('cobro', () => {
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

  const checkout = (cart: CartDetailDto, body: object) =>
    pos.luis.post(`/pos/carts/${cart.id}/checkout`, {
      cashSessionId: c1,
      verifiedUnits: 0,
      ...body,
    });

  it('el vendedor arma, el cajero cobra en efectivo (T14)', async () => {
    const cart = await cartWith(pos.ana, [
      [pos.shoe, pos.racks.a1],
      [pos.belt, pos.racks.a2],
    ]);
    const ticket = expectStatus<SaleTicketDto>(
      await checkout(cart, {
        payments: [{ method: 'CASH', amount: 124800, received: 130000 }],
        verifiedUnits: 2,
        customerName: 'María',
      }),
      201,
    );
    expect(ticket.sale).toMatchObject({
      folio: 'S1-000001',
      branchId: pos.s1.branchId,
      cashSessionId: c1,
      cashRegisterId: pos.registers.S1.C1,
      sellerId: pos.anaId,
      cashierId: pos.luisId,
      cartId: cart.id,
      customerName: 'María',
      subtotal: 124800,
      discountTotal: 0,
      taxTotal: 17214,
      total: 124800,
      taxRateBp: 1600,
      pricesIncludeTax: true,
      status: 'COMPLETED',
    });
    expect(
      ticket.items.map((i) => [i.skuSnapshot, i.nameSnapshot, i.variantLabelSnapshot, i.lineTotal]),
    ).toEqual([
      ['ZAP0101-25-NEG', 'Zapato de piel dama', '25 · Negro', 89900],
      ['CIN0001', 'Cinturón', null, 34900],
    ]);
    expect(ticket.payments).toEqual([
      expect.objectContaining({ method: 'CASH', amount: 124800, received: 130000, change: 5200 }),
    ]);
    expect(ticket).toMatchObject({
      cashRegister: { code: 'C1', name: 'Caja 1' },
      seller: { id: pos.anaId, fullName: 'Ana López' },
      cashier: { id: pos.luisId, fullName: 'Luis Mora' },
      cancelledBy: null,
      branch: { code: 'S1', timezone: 'America/Mexico_City', currency: 'MXN' },
    });

    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 9, reservedQty: 0 });
    expect(await stockOf(prisma, pos.belt, pos.racks.a2)).toEqual({ quantity: 9, reservedQty: 0 });
    const sales = await prisma.inventoryMovement.findMany({
      where: { type: 'SALE' },
      orderBy: { quantity: 'asc' },
    });
    expect(sales).toHaveLength(2);
    for (const move of sales) {
      expect(move).toMatchObject({ referenceType: 'SALE', referenceId: ticket.sale.id });
    }
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe(
      'CHECKED_OUT',
    );

    // Folios consecutivos por sucursal.
    const second = await payCash(pos.luis, await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]), c1);
    expect(second.sale.folio).toBe('S1-000002');
    const s2Session = await openSession(pos.managerS2, pos.registers.S2.C1);
    const s2Cart = await cartWith(pos.managerS2, [[pos.shoe, pos.racks.b1]]);
    const s2Ticket = await payCash(pos.managerS2, s2Cart, s2Session.id);
    expect(s2Ticket.sale.folio).toBe('S2-000001');
  });

  it('pagos, estados del carrito, total 0 y verificación en caja (T15)', async () => {
    const cart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);

    const mismatch = await checkout(cart, { payments: [{ method: 'CASH', amount: 80000 }] });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({
      code: 'PAYMENT_TOTAL_MISMATCH',
      details: { total: 89900, paid: 80000 },
    });
    expect(await prisma.sale.count()).toBe(0);

    const mixed = expectStatus<SaleTicketDto>(
      await checkout(cart, {
        payments: [
          { method: 'CASH', amount: 59900, received: 60000 },
          { method: 'CARD', amount: 30000, reference: 'AUT-77' },
        ],
        verifiedUnits: 1,
      }),
      201,
    );
    // El cobro fallido no consumió folio.
    expect(mixed.sale.folio).toBe('S1-000001');
    expect(
      mixed.payments.map((p) => [p.method, p.amount, p.received, p.change, p.reference]),
    ).toEqual([
      ['CASH', 59900, 60000, 100, null],
      ['CARD', 30000, null, null, 'AUT-77'],
    ]);

    const again = await checkout(cart, { payments: [{ method: 'CASH', amount: 89900 }] });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('CART_NOT_EDITABLE');

    const empty = await cartWith(pos.ana);
    const emptyRes = await checkout(empty, { payments: [] });
    expect(emptyRes.statusCode).toBe(409);
    expect(emptyRes.json().code).toBe('CART_EMPTY');

    // Total 0 por descuento: se cobra sin pagos.
    const free = await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]);
    expectStatus(await pos.manager.patch(`/pos/carts/${free.id}`, { discount: 34900 }), 200);
    const freeTicket = expectStatus<SaleTicketDto>(
      await checkout(free, { payments: [], verifiedUnits: 1 }),
      201,
    );
    expect(freeTicket.sale.total).toBe(0);
    expect(freeTicket.payments).toEqual([]);

    // Un carrito suspendido se cobra directo; el mismo vendedor cobra el suyo.
    const own = await cartWith(pos.luis, [[pos.belt, pos.racks.a2]]);
    expectStatus(await pos.luis.post(`/pos/carts/${own.id}/suspend`, {}), 200);
    const ownTicket = expectStatus<SaleTicketDto>(
      await checkout(own, { payments: [{ method: 'TRANSFER', amount: 34900 }], verifiedUnits: 1 }),
      201,
    );
    expect(ownTicket.sale.sellerId).toBe(ownTicket.sale.cashierId);

    // Verificación en caja: menos piezas → audit; todas → sin audit; más → 400.
    const partial = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);
    const tooMany = await checkout(partial, {
      payments: [{ method: 'CASH', amount: 179800 }],
      verifiedUnits: 3,
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().details).toEqual([expect.objectContaining({ path: 'verifiedUnits' })]);
    const unverified = expectStatus<SaleTicketDto>(
      await checkout(partial, { payments: [{ method: 'CASH', amount: 179800 }], verifiedUnits: 1 }),
      201,
    );
    const audits = await prisma.auditLog.findMany({ where: { action: 'pos.checkout.unverified' } });
    // `free` y `own` se cobraron con todo verificado; `mixed` también.
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity: 'Sale',
      entityId: unverified.sale.id,
      userId: pos.luisId,
      payload: expect.objectContaining({
        saleId: unverified.sale.id,
        verifiedUnits: 1,
        totalUnits: 2,
      }),
    });

    // Caja cerrada o de otra sucursal.
    const pending = await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]);
    const s2Session = await openSession(pos.managerS2, pos.registers.S2.C1);
    const foreign = await checkout(pending, {
      cashSessionId: s2Session.id,
      payments: [{ method: 'CASH', amount: 34900 }],
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().code).toBe('BRANCH_FORBIDDEN');
    const c2 = await openSession(pos.luis, pos.registers.S1.C2);
    expectStatus(await pos.luis.post(`/pos/cash-sessions/${c1}/close`, { countedAmount: 0 }), 200);
    const closed = await checkout(pending, { payments: [{ method: 'CASH', amount: 34900 }] });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe('CASH_SESSION_CLOSED');
    // El carrito no se pierde: se cobra en la otra caja.
    expectStatus(
      await checkout(pending, {
        cashSessionId: c2.id,
        payments: [{ method: 'CASH', amount: 34900 }],
      }),
      201,
    );
  });

  it('sin IVA incluido y con el IVA vigente al cobrar (T16)', async () => {
    const cart = await cartWith(pos.ana, [
      [pos.shoe, pos.racks.a1],
      [pos.belt, pos.racks.a2],
    ]);
    expectStatus(
      await pos.manager.patch(`/pos/carts/${cart.id}/items/${cart.items[0]!.id}`, {
        discount: 10000,
      }),
      200,
    );
    expectStatus(await pos.manager.patch(`/pos/carts/${cart.id}`, { discount: 4800 }), 200);
    // Se cambia la configuración después de armar el carrito: aplica al cobrar.
    await prisma.branch.update({
      where: { id: pos.s1.branchId },
      data: { pricesIncludeTax: false, taxRateBp: 800 },
    });
    const ticket = expectStatus<SaleTicketDto>(
      await checkout(cart, { payments: [{ method: 'CARD', amount: 118800 }], verifiedUnits: 2 }),
      201,
    );
    expect(ticket.sale).toMatchObject({
      subtotal: 124800,
      globalDiscount: 4800,
      discountTotal: 14800,
      taxRateBp: 800,
      pricesIncludeTax: false,
      taxTotal: 8800,
      total: 118800,
    });
    // `sale_total_check` se cumple en la BD.
    const [check] = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT total = subtotal - discount_total + tax_total AS ok FROM sale WHERE id = ${ticket.sale.id}::uuid`;
    expect(check!.ok).toBe(true);
  });

  it('cada venta queda en la caja que cobra y los cortes cuadran (T17)', async () => {
    const c2 = (await openSession(pos.juan, pos.registers.S1.C2, 20000)).id;
    const first = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    const second = await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]);

    const inC1 = await payCash(pos.luis, first, c1);
    const inC2 = await payCash(pos.juan, second, c2);
    expect(inC1.sale).toMatchObject({ cashRegisterId: pos.registers.S1.C1, cashSessionId: c1 });
    expect(inC2.sale).toMatchObject({ cashRegisterId: pos.registers.S1.C2, cashSessionId: c2 });

    const history = async (sessionId: string) =>
      expectStatus<{ items: SaleListItemDto[] }>(
        await pos.manager.get(`/pos/cash-sessions/${sessionId}/sales`),
        200,
      ).items.map((s) => s.folio);
    expect(await history(c1)).toEqual([inC1.sale.folio]);
    expect(await history(c2)).toEqual([inC2.sale.folio]);

    const close1 = expectStatus<CashSessionSummaryDto>(
      await pos.luis.post(`/pos/cash-sessions/${c1}/close`, { countedAmount: 50000 + 89900 }),
      200,
    );
    const close2 = expectStatus<CashSessionSummaryDto>(
      await pos.juan.post(`/pos/cash-sessions/${c2}/close`, { countedAmount: 20000 + 34900 }),
      200,
    );
    expect(close1).toMatchObject({ expectedAmount: 139900, difference: 0, salesCount: 1 });
    expect(close2).toMatchObject({ expectedAmount: 54900, difference: 0, salesCount: 1 });
  });
});
