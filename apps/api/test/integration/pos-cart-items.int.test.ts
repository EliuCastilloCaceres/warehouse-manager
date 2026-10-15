import { type CartDetailDto, computeSaleTotals } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createTestClient } from './helpers/db.js';
import {
  cartWith,
  expectStatus,
  openSession,
  type PosScenario,
  resetPos,
  setupPos,
  stockOf,
} from './helpers/pos.js';

describe('partidas del carrito', () => {
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
    await openSession(pos.luis, pos.registers.S1.C1);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Cierra todas las cajas directo en la BD (sin la revisión de carritos del corte). */
  const closeAllSessions = () =>
    prisma.cashSession.updateMany({
      where: { status: 'OPEN' },
      data: {
        status: 'CLOSED',
        closedById: pos.adminId,
        closedAt: new Date(),
        expectedAmount: 0,
        countedAmount: 0,
        difference: 0,
      },
    });

  const add = (cartId: string, variantId: string, sourceRackId: string, quantity = 1) =>
    pos.ana.post(`/pos/carts/${cartId}/items`, { variantId, sourceRackId, quantity });

  it('agregar reserva, suma partidas y valida variante, rack y caja (T10)', async () => {
    await prisma.productVariant.update({ where: { id: pos.shoe }, data: { priceOverride: 99900 } });
    const cart = await cartWith(pos.ana);

    const added = expectStatus<CartDetailDto>(await add(cart.id, pos.shoe, pos.racks.a1, 2), 201);
    expect(added.items).toEqual([
      expect.objectContaining({ quantity: 2, unitPrice: 99900, sourceRackId: pos.racks.a1 }),
    ]);
    const pick = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'PICK' } });
    expect(pick).toMatchObject({
      quantity: 2,
      fromRackId: pos.racks.a1,
      referenceType: 'CART',
      referenceId: cart.id,
      userId: pos.anaId,
    });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 10, reservedQty: 2 });

    // La misma variante del mismo rack se suma; desde staging es otra partida.
    expectStatus(await add(cart.id, pos.shoe, pos.racks.a1), 201);
    const withStaging = expectStatus<CartDetailDto>(
      await add(cart.id, pos.shoe, pos.racks.staging),
      201,
    );
    expect(withStaging.items.map((i) => [i.locationCode, i.isStaging, i.quantity])).toEqual([
      ['A-01-01', false, 3],
      ['STG-01-01', true, 1],
    ]);

    const tooMany = await add(cart.id, pos.shoe, pos.racks.a1, 8);
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json()).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { available: 7, requested: 8 },
    });

    await prisma.productVariant.update({ where: { id: pos.belt }, data: { isActive: false } });
    const inactive = await add(cart.id, pos.belt, pos.racks.a2);
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().code).toBe('VARIANT_INACTIVE');
    await prisma.productVariant.update({ where: { id: pos.belt }, data: { isActive: true } });
    await prisma.product.update({ where: { id: pos.beltProductId }, data: { isActive: false } });
    expect((await add(cart.id, pos.belt, pos.racks.a2)).json().code).toBe('VARIANT_INACTIVE');

    const otherBranch = await add(cart.id, pos.shoe, pos.racks.b1);
    expect(otherBranch.statusCode).toBe(400);
    expect(otherBranch.json().details).toEqual([
      { path: 'sourceRackId', message: 'La ubicación no es de esta sucursal' },
    ]);

    // El precio de la partida no cambia si cambia el del catálogo.
    await prisma.productVariant.update({ where: { id: pos.shoe }, data: { priceOverride: null } });
    await prisma.product.update({ where: { id: pos.shoeProductId }, data: { price: 1000 } });
    const kept = expectStatus<CartDetailDto>(await pos.ana.get(`/pos/carts/${cart.id}`), 200);
    expect(kept.items[0]!.unitPrice).toBe(99900);
    expect(kept.items[1]!.unitPrice).toBe(99900);

    await closeAllSessions();
    const noSession = await add(cart.id, pos.shoe, pos.racks.a1);
    expect(noSession.statusCode).toBe(409);
    expect(noSession.json().code).toBe('NO_OPEN_CASH_SESSION');
  });

  it('cambiar la cantidad y quitar liberan al rack o a staging (T11)', async () => {
    const cart = await cartWith(pos.ana, [[pos.shoe, pos.racks.a1, 2]]);
    const itemId = cart.items[0]!.id;
    const patch = (body: object) => pos.ana.patch(`/pos/carts/${cart.id}/items/${itemId}`, body);
    const lastMove = () =>
      prisma.inventoryMovement.findFirstOrThrow({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

    expect(expectStatus<CartDetailDto>(await patch({ quantity: 4 }), 200).items[0]!.quantity).toBe(
      4,
    );
    expect(await lastMove()).toMatchObject({ type: 'PICK', quantity: 2 });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 10, reservedQty: 4 });

    expectStatus(await patch({ quantity: 3 }), 200);
    expect(await lastMove()).toMatchObject({
      type: 'RETURN_TO_RACK',
      quantity: 1,
      toRackId: pos.racks.a1,
    });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 10, reservedQty: 3 });

    expectStatus(await patch({ quantity: 2, releaseTo: 'STAGING' }), 200);
    expect(await lastMove()).toMatchObject({
      type: 'TO_STAGING',
      quantity: 1,
      fromRackId: pos.racks.a1,
      toRackId: pos.racks.staging,
    });
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 9, reservedQty: 2 });
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 4,
      reservedQty: 0,
    });

    // Una partida tomada de staging se libera en su lugar aunque se pida staging.
    const withStaging = expectStatus<CartDetailDto>(
      await add(cart.id, pos.shoe, pos.racks.staging),
      201,
    );
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 4,
      reservedQty: 1,
    });
    const stagingItem = withStaging.items.find((i) => i.isStaging)!;

    // Quitar y descartar funcionan sin cajas abiertas.
    await closeAllSessions();
    const removed = expectStatus<CartDetailDto>(
      await pos.ana.delete(`/pos/carts/${cart.id}/items/${stagingItem.id}?releaseTo=STAGING`),
      200,
    );
    expect(removed.items.map((i) => i.id)).toEqual([itemId]);
    expect(await lastMove()).toMatchObject({ type: 'RETURN_TO_RACK', toRackId: pos.racks.staging });
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 4,
      reservedQty: 0,
    });

    // Subir la cantidad sí exige una caja abierta (es agregar).
    expect((await patch({ quantity: 3 })).json().code).toBe('NO_OPEN_CASH_SESSION');

    expectStatus(
      await pos.ana.delete(`/pos/carts/${cart.id}/items/${itemId}?releaseTo=STAGING`),
      200,
    );
    expect(await stockOf(prisma, pos.shoe, pos.racks.a1)).toEqual({ quantity: 7, reservedQty: 0 });
    expect(await stockOf(prisma, pos.shoe, pos.racks.staging)).toEqual({
      quantity: 6,
      reservedQty: 0,
    });

    // Partida de otro carrito → 404.
    await openSession(pos.luis, pos.registers.S1.C2);
    const other = await cartWith(pos.juan, [[pos.belt, pos.racks.a2]]);
    const foreign = await pos.ana.delete(`/pos/carts/${cart.id}/items/${other.items[0]!.id}`);
    expect(foreign.statusCode).toBe(404);
    expect(
      (await pos.ana.patch(`/pos/carts/${cart.id}/items/${other.items[0]!.id}`, { quantity: 1 }))
        .statusCode,
    ).toBe(404);

    await closeAllSessions();
    const discarded = expectStatus<CartDetailDto>(
      await pos.juan.post(`/pos/carts/${other.id}/discard`, { releaseTo: 'RACK' }),
      200,
    );
    expect(discarded.status).toBe('DISCARDED');
    expect(await stockOf(prisma, pos.belt, pos.racks.a2)).toEqual({ quantity: 10, reservedQty: 0 });
  });

  it('descuentos: permiso, tope y recorte al bajar cantidades (T12)', async () => {
    const cart = await cartWith(pos.ana, [
      [pos.shoe, pos.racks.a1, 2],
      [pos.belt, pos.racks.a2],
    ]);
    const [shoeItem, beltItem] = cart.items;

    const noPermission = [
      await pos.ana.patch(`/pos/carts/${cart.id}/items/${shoeItem!.id}`, { discount: 100 }),
      await pos.ana.patch(`/pos/carts/${cart.id}`, { discount: 100 }),
    ];
    for (const res of noPermission) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'pos.discount' },
      });
    }

    expectStatus(
      await pos.manager.patch(`/pos/carts/${cart.id}/items/${shoeItem!.id}`, { discount: 10000 }),
      200,
    );
    const withGlobal = expectStatus<CartDetailDto>(
      await pos.manager.patch(`/pos/carts/${cart.id}`, { discount: 4800 }),
      200,
    );
    const expected = computeSaleTotals({
      lines: [
        { unitPrice: 89900, quantity: 2, discount: 10000 },
        { unitPrice: 34900, quantity: 1, discount: 0 },
      ],
      globalDiscount: 4800,
      taxRateBp: 1600,
      pricesIncludeTax: true,
    });
    expect(withGlobal.totals).toEqual({ ...expected, taxRateBp: 1600, pricesIncludeTax: true });
    expect(withGlobal.items[0]!.lineTotal).toBe(169800);

    const tooBig = await pos.manager.patch(`/pos/carts/${cart.id}/items/${beltItem!.id}`, {
      discount: 34901,
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json().details).toEqual([expect.objectContaining({ path: 'discount' })]);
    const globalTooBig = await pos.manager.patch(`/pos/carts/${cart.id}`, { discount: 204701 });
    expect(globalTooBig.statusCode).toBe(400);

    // Zapato: 2 × 89900 con 100000 de descuento; global 100000 (cabe en 79800 + 34900).
    expectStatus(
      await pos.manager.patch(`/pos/carts/${cart.id}/items/${shoeItem!.id}`, { discount: 100000 }),
      200,
    );
    expectStatus(await pos.manager.patch(`/pos/carts/${cart.id}`, { discount: 100000 }), 200);
    // Al bajar a 1, el descuento de la partida se recorta a 89900 y el global a lo que queda.
    const lowered = expectStatus<CartDetailDto>(
      await pos.ana.patch(`/pos/carts/${cart.id}/items/${shoeItem!.id}`, { quantity: 1 }),
      200,
    );
    expect(lowered.items[0]).toMatchObject({ quantity: 1, discount: 89900, lineTotal: 0 });
    expect(lowered.discount).toBe(34900);
    expect(lowered.totals.total).toBe(0);

    // Quitar una partida también recorta el global.
    const removed = expectStatus<CartDetailDto>(
      await pos.ana.delete(`/pos/carts/${cart.id}/items/${beltItem!.id}`),
      200,
    );
    expect(removed.discount).toBe(0);
    expect(removed.totals.total).toBe(0);
  });
});
