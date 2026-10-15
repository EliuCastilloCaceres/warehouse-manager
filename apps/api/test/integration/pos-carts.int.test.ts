import type { CartDetailDto, CartSummaryDto } from '@warehouse-manager/shared';
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

describe('carritos del POS', () => {
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

  const statusOf = async (id: string) =>
    (await prisma.cart.findUniqueOrThrow({ where: { id } })).status;

  it('números cortos, carrito nuevo y límite de suspendidos (T8)', async () => {
    const closed = await pos.ana.post('/pos/carts', {});
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe('NO_OPEN_CASH_SESSION');

    const session = await openSession(pos.luis, pos.registers.S1.C1);
    const first = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    expect(first).toMatchObject({
      status: 'ACTIVE',
      branchId: pos.s1.branchId,
      number: 1,
      owner: { id: pos.anaId },
    });
    const juanCart = await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]);
    const luisCart = await cartWith(pos.luis);
    expect([juanCart.number, luisCart.number]).toEqual([2, 3]);

    // Cobrar el #1 lo libera: el siguiente carrito nuevo de la sucursal lo recibe.
    await payCash(pos.luis, first, session.id);
    const reused = await cartWith(pos.manager);
    expect(reused.number).toBe(1);
    // Descartar también lo libera.
    expectStatus(
      await pos.manager.post(`/pos/carts/${reused.id}/discard`, { releaseTo: 'RACK' }),
      200,
    );
    expect((await cartWith(pos.ana)).number).toBe(1);

    // Suspender y retomar conservan el número.
    const suspended = expectStatus<CartDetailDto>(
      await pos.juan.post(`/pos/carts/${juanCart.id}/suspend`, {}),
      200,
    );
    expect(suspended).toMatchObject({ status: 'SUSPENDED', number: 2 });
    const resumed = expectStatus<CartDetailDto>(
      await pos.juan.post(`/pos/carts/${juanCart.id}/resume`),
      200,
    );
    expect(resumed).toMatchObject({ status: 'ACTIVE', number: 2 });

    // Con el activo vacío se reutiliza (200 y la etiqueta nueva).
    const again = await pos.luis.post('/pos/carts', { label: 'Joven tenis' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: luisCart.id, number: 3, label: 'Joven tenis' });

    // Con partidas, el activo pasa a suspendido y se crea otro.
    expectStatus(
      await pos.luis.post(`/pos/carts/${luisCart.id}/items`, {
        variantId: pos.belt,
        sourceRackId: pos.racks.a2,
        quantity: 1,
      }),
      201,
    );
    const next = expectStatus<CartDetailDto>(await pos.luis.post('/pos/carts', {}), 201);
    expect(next.id).not.toBe(luisCart.id);
    expect(next.status).toBe('ACTIVE');
    expect(await statusOf(luisCart.id)).toBe('SUSPENDED');

    // Ana llega a 5 suspendidos; el sexto falla y su carrito activo sigue igual.
    const anaActive = (
      await prisma.cart.findFirstOrThrow({ where: { userId: pos.anaId, status: 'ACTIVE' } })
    ).id;
    expectStatus(
      await pos.ana.post(`/pos/carts/${anaActive}/items`, {
        variantId: pos.shoe,
        sourceRackId: pos.racks.a1,
        quantity: 1,
      }),
      201,
    );
    for (let i = 0; i < 5; i++) {
      const cart = expectStatus<CartDetailDto>(await pos.ana.post('/pos/carts', {}), 201);
      expectStatus(
        await pos.ana.post(`/pos/carts/${cart.id}/items`, {
          variantId: pos.belt,
          sourceRackId: pos.racks.a2,
          quantity: 1,
        }),
        201,
      );
    }
    expect(await prisma.cart.count({ where: { userId: pos.anaId, status: 'SUSPENDED' } })).toBe(5);
    const limit = await pos.ana.post('/pos/carts', {});
    expect(limit.statusCode).toBe(409);
    expect(limit.json().code).toBe('CART_LIMIT_REACHED');
    expect(await prisma.cart.count({ where: { userId: pos.anaId, status: 'ACTIVE' } })).toBe(1);

    // Otro vendedor sí puede suspender.
    expectStatus(await pos.juan.post(`/pos/carts/${juanCart.id}/suspend`, {}), 200);

    // El índice `cart_one_active_per_user_branch` impide un segundo activo.
    await expect(
      prisma.cart.create({
        data: { branchId: pos.s1.branchId, userId: pos.anaId, number: 900, status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
  });

  it('suspender guarda etiqueta y reservas; retomar cambia el activo; solo el dueño (T9)', async () => {
    await openSession(pos.luis, pos.registers.S1.C1);
    const cart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);
    const before = await stockOf(prisma, pos.shoe, pos.racks.a1);

    const suspended = expectStatus<CartDetailDto>(
      await pos.ana.post(`/pos/carts/${cart.id}/suspend`, {
        label: 'Señora vestido rojo',
        customerName: 'María',
      }),
      200,
    );
    expect(suspended).toMatchObject({
      status: 'SUSPENDED',
      label: 'Señora vestido rojo',
      customerName: 'María',
    });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual(before);
    expect(before.reservedQty).toBe(2);

    // Un carrito vacío no se suspende.
    const empty = expectStatus<CartDetailDto>(await pos.ana.post('/pos/carts', {}), 201);
    const notEmpty = await pos.ana.post(`/pos/carts/${empty.id}/suspend`, {});
    expect(notEmpty.statusCode).toBe(409);
    expect(notEmpty.json().code).toBe('CART_EMPTY');

    // Retomar con el activo vacío: el vacío se descarta.
    expectStatus(await pos.ana.post(`/pos/carts/${cart.id}/resume`), 200);
    expect(await statusOf(cart.id)).toBe('ACTIVE');
    expect(await statusOf(empty.id)).toBe('DISCARDED');

    // Retomar con el activo con partidas: ese pasa a suspendido.
    expectStatus(await pos.ana.post(`/pos/carts/${cart.id}/suspend`, {}), 200);
    const other = await cartWith(pos.ana, [[pos.belt, pos.racks.a2]]);
    expectStatus(await pos.ana.post(`/pos/carts/${cart.id}/resume`), 200);
    expect(await statusOf(cart.id)).toBe('ACTIVE');
    expect(await statusOf(other.id)).toBe('SUSPENDED');

    // Solo el dueño suspende o retoma.
    for (const res of [
      await pos.juan.post(`/pos/carts/${cart.id}/suspend`, {}),
      await pos.juan.post(`/pos/carts/${other.id}/resume`),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
  });

  it('carritos de la sucursal: listar, buscar por número y atender carritos ajenos (T13)', async () => {
    await openSession(pos.luis, pos.registers.S1.C1);
    const anaCart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);
    expectStatus(await pos.ana.post(`/pos/carts/${anaCart.id}/suspend`, { label: 'Rojo' }), 200);
    const juanCart = await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]);
    // Uno descartado: ya no aparece en la lista.
    const discardedCart = await cartWith(pos.luis, [[pos.belt, pos.racks.a2]]);
    expectStatus(
      await pos.luis.post(`/pos/carts/${discardedCart.id}/discard`, { releaseTo: 'RACK' }),
      200,
    );

    const all = expectStatus<CartSummaryDto[]>(await pos.luis.get('/pos/carts?scope=all'), 200);
    expect(all.map((c) => [c.number, c.status, c.owner.fullName, c.unitCount, c.total])).toEqual([
      [1, 'SUSPENDED', 'Ana López', 2, 179800],
      [2, 'ACTIVE', 'Juan Pérez', 1, 34900],
    ]);
    expect(all[0]).toMatchObject({ label: 'Rojo', itemCount: 1 });
    const mine = expectStatus<CartSummaryDto[]>(await pos.ana.get('/pos/carts'), 200);
    expect(mine.map((c) => c.id)).toEqual([anaCart.id]);
    const byNumber = expectStatus<CartSummaryDto[]>(
      await pos.luis.get('/pos/carts?scope=all&number=2'),
      200,
    );
    expect(byNumber.map((c) => c.id)).toEqual([juanCart.id]);
    expect((await pos.luis.get('/pos/carts?scope=all&number=1000')).statusCode).toBe(400);

    // Otro usuario con pos.sell ve, edita y descarta el carrito de Ana.
    const detail = expectStatus<CartDetailDto>(await pos.luis.get(`/pos/carts/${anaCart.id}`), 200);
    expect(detail.items).toEqual([
      expect.objectContaining({
        sku: 'ZAP0101-25-NEG',
        barcode: '7501234567890',
        productName: 'Zapato de piel dama',
        variantLabel: '25 · Negro',
        locationCode: 'A-01-01',
        isStaging: false,
        quantity: 2,
        lineTotal: 179800,
      }),
    ]);
    const edited = expectStatus<CartDetailDto>(
      await pos.luis.patch(`/pos/carts/${anaCart.id}/items/${detail.items[0]!.id}`, {
        quantity: 1,
      }),
      200,
    );
    expect(edited.items[0]!.quantity).toBe(1);
    const discarded = expectStatus<CartDetailDto>(
      await pos.luis.post(`/pos/carts/${anaCart.id}/discard`, { releaseTo: 'RACK' }),
      200,
    );
    expect(discarded.status).toBe('DISCARDED');
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 10, reservedQty: 0 });

    // Cualquier cambio posterior → CART_NOT_EDITABLE.
    for (const res of [
      await pos.ana.patch(`/pos/carts/${anaCart.id}`, { label: 'x' }),
      await pos.ana.post(`/pos/carts/${anaCart.id}/items`, {
        variantId: pos.shoe,
        sourceRackId: pos.racks.a1,
        quantity: 1,
      }),
      await pos.ana.post(`/pos/carts/${anaCart.id}/discard`, { releaseTo: 'RACK' }),
      await pos.ana.post(`/pos/carts/${anaCart.id}/resume`),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CART_NOT_EDITABLE');
    }

    // Un carrito de otra sucursal (o que no existe) → BRANCH_FORBIDDEN.
    const s2Cart = await prisma.cart.create({
      data: { branchId: pos.s2.branchId, userId: pos.managerId, number: 1 },
    });
    for (const url of [
      `/pos/carts/${s2Cart.id}`,
      '/pos/carts/9a8b7c6d-5e4f-4a3b-8c2d-000000000000',
    ]) {
      const res = await pos.ana.get(url);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('BRANCH_FORBIDDEN');
    }
    expect((await pos.ana.get('/pos/carts/no-uuid')).statusCode).toBe(400);
  });
});
