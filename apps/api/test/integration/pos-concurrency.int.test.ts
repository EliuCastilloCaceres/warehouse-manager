import type { CartDetailDto, SaleTicketDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import {
  BELT_PRICE,
  cartWith,
  openSession,
  type PosScenario,
  resetPos,
  setupPos,
  stockOf,
} from './helpers/pos.js';
import { type Api, apiAs } from './helpers/warehouse.js';

describe('POS con operaciones simultáneas (T22)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pos: PosScenario;
  let sellers: Api[];

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    pos = await setupPos(prisma, app);
    sellers = [];
    for (let i = 1; i <= 10; i++) {
      const session = await createAndLogin(app, prisma, { username: `vendedor${i}` });
      sellers.push(apiAs(app, session.accessToken));
    }
  });

  beforeEach(async () => {
    await resetPos(prisma, pos);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const codes = (results: { statusCode: number; body: string }[]) =>
    results
      .map((r) => (r.statusCode < 300 ? String(r.statusCode) : JSON.parse(r.body).code))
      .sort();

  it('dos vendedores agregan la última unidad: uno la reserva', async () => {
    await openSession(pos.luis, pos.registers.S1.C1);
    await prisma.stockLocation.updateMany({
      where: { variantId: pos.belt, rackId: pos.racks.a2 },
      data: { quantity: 1 },
    });
    const carts = [await cartWith(pos.ana), await cartWith(pos.juan)];
    const results = await Promise.all([
      pos.ana.post(`/pos/carts/${carts[0]!.id}/items`, {
        variantId: pos.belt,
        sourceRackId: pos.racks.a2,
        quantity: 1,
      }),
      pos.juan.post(`/pos/carts/${carts[1]!.id}/items`, {
        variantId: pos.belt,
        sourceRackId: pos.racks.a2,
        quantity: 1,
      }),
    ]);
    expect(codes(results)).toEqual(['201', 'STOCK_INSUFFICIENT']);
    expect(await stockOf(prisma, pos.belt, pos.racks.a2)).toEqual({ quantity: 1, reservedQty: 1 });
  });

  it('10 cobros en dos cajas: folios consecutivos sin huecos ni duplicados', async () => {
    const sessions = [
      (await openSession(pos.luis, pos.registers.S1.C1)).id,
      (await openSession(pos.luis, pos.registers.S1.C2)).id,
    ];
    const carts: CartDetailDto[] = [];
    for (const seller of sellers) carts.push(await cartWith(seller, [[pos.belt, pos.racks.a2]]));

    const results = await Promise.all(
      carts.map((cart, i) =>
        (i % 2 === 0 ? pos.luis : pos.manager).post(`/pos/carts/${cart.id}/checkout`, {
          cashSessionId: sessions[i % 2],
          payments: [{ method: 'CASH', amount: BELT_PRICE }],
          verifiedUnits: 1,
        }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    const folios = results.map((r) => (r.json() as SaleTicketDto).sale.folio).sort();
    expect(folios).toEqual(
      Array.from({ length: 10 }, (_, i) => `S1-${String(i + 1).padStart(6, '0')}`),
    );
    expect(await stockOf(prisma, pos.belt, pos.racks.a2)).toEqual({ quantity: 0, reservedQty: 0 });
  });

  it('dos cajas cobran el mismo carrito: una cobra y la otra recibe CART_NOT_EDITABLE', async () => {
    const c1 = (await openSession(pos.luis, pos.registers.S1.C1)).id;
    const c2 = (await openSession(pos.juan, pos.registers.S1.C2)).id;
    const cart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    const pay = (api: Api, cashSessionId: string) =>
      api.post(`/pos/carts/${cart.id}/checkout`, {
        cashSessionId,
        payments: [{ method: 'CASH', amount: 89900 }],
        verifiedUnits: 1,
      });
    const results = await Promise.all([pay(pos.luis, c1), pay(pos.juan, c2)]);
    expect(codes(results)).toEqual(['201', 'CART_NOT_EDITABLE']);
    expect(await prisma.sale.count()).toBe(1);
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 9, reservedQty: 0 });
  });

  it('dos aperturas de la misma caja: una abre y la otra recibe CASH_SESSION_ALREADY_OPEN', async () => {
    const body = { cashRegisterId: pos.registers.S1.C1, openingAmount: 50000 };
    const results = await Promise.all([
      pos.luis.post('/pos/cash-sessions/open', body),
      pos.juan.post('/pos/cash-sessions/open', body),
    ]);
    expect(codes(results)).toEqual(['201', 'CASH_SESSION_ALREADY_OPEN']);
    expect(await prisma.cashSession.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('10 vendedores crean carrito a la vez: números 1 a 10 sin repetir', async () => {
    await openSession(pos.luis, pos.registers.S1.C1);
    const results = await Promise.all(sellers.map((seller) => seller.post('/pos/carts', {})));
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    const numbers = results.map((r) => (r.json() as CartDetailDto).number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cerrar las dos últimas cajas a la vez con un carrito pendiente: nunca cierran ambas', async () => {
    const c1 = (await openSession(pos.luis, pos.registers.S1.C1)).id;
    const c2 = (await openSession(pos.luis, pos.registers.S1.C2)).id;
    await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    const results = await Promise.all(
      [c1, c2].map((id) =>
        pos.luis.post(`/pos/cash-sessions/${id}/close`, { countedAmount: 50000 }),
      ),
    );
    expect(codes(results)).toContain('CASH_SESSION_HAS_OPEN_CARTS');
    expect(await prisma.cashSession.count({ where: { status: 'OPEN' } })).toBeGreaterThanOrEqual(1);
  });
});
