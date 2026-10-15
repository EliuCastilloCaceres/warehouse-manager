import type { CartDetailDto, PosSessionDto, SaleTicketDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { createAndLogin, loginSeeded } from './auth.js';
import { resetWithSeed } from './seed.js';
import { type Api, apiAs, createStructure, putStock, warehouseOf } from './warehouse.js';

export const SHOE_PRICE = 89900;
export const BELT_PRICE = 34900;

/** Respuesta de la API con estado esperado; si no coincide, falla con el body. */
export function expectStatus<T>(res: { statusCode: number; body: string }, status: number): T {
  if (res.statusCode !== status) {
    throw new Error(`Se esperaba ${status} y llegó ${res.statusCode}: ${res.body}`);
  }
  return JSON.parse(res.body) as T;
}

/**
 * Escenario del POS sobre el seed base (S1 y S2 con cajas C1 y C2):
 * - usuarios: Ana y Juan (Vendedor), Luis (Vendedor, cajero), Gerente y Almacenista (sin POS);
 * - S1: zona A con A-01-01 (zapato) y A-01-02 (cinturón) y staging; S2: B-01-01 (zapato);
 * - zapato `ZAP0101-25-NEG` a $899.00 y cinturón `CIN0001` a $349.00.
 */
export async function setupPos(prisma: PrismaClient, app: FastifyInstance) {
  await resetWithSeed(prisma);
  const admin = await loginSeeded(app, prisma, 'admin');
  const login = (
    username: string,
    fullName: string,
    role: 'SELLER' | 'MANAGER' | 'WAREHOUSE_CLERK',
    branches = ['S1'],
  ) => createAndLogin(app, prisma, { username, fullName, role, branches });
  const [ana, juan, luis, manager, clerk] = [
    await login('ana', 'Ana López', 'SELLER'),
    await login('juan', 'Juan Pérez', 'SELLER'),
    await login('luis', 'Luis Mora', 'SELLER'),
    await login('gerente', 'Gerente S1', 'MANAGER', ['S1', 'S2']),
    await login('almacen', 'Almacenista', 'WAREHOUSE_CLERK'),
  ];
  const s1 = await warehouseOf(prisma, 'S1');
  const s2 = await warehouseOf(prisma, 'S2');
  const a = await createStructure(prisma, s1.id, { zone: 'A', racks: ['01', '02'] });
  const b = await createStructure(prisma, s2.id, { zone: 'B' });

  const shoeProduct = await prisma.product.create({
    data: { sku: 'ZAP0101', name: 'Zapato de piel dama', type: 'VARIABLE', price: SHOE_PRICE },
  });
  const shoe = await prisma.productVariant.create({
    data: {
      productId: shoeProduct.id,
      sku: 'ZAP0101-25-NEG',
      barcode: '7501234567890',
      size: '25',
      color: 'Negro',
    },
  });
  const beltProduct = await prisma.product.create({
    data: { sku: 'CIN0001', name: 'Cinturón', type: 'SIMPLE', price: BELT_PRICE },
  });
  const belt = await prisma.productVariant.create({
    data: { productId: beltProduct.id, sku: 'CIN0001' },
  });

  const registers = async (branch: string) => {
    const rows = await prisma.cashRegister.findMany({ where: { branch: { code: branch } } });
    return Object.fromEntries(rows.map((r) => [r.code, r.id])) as Record<'C1' | 'C2', string>;
  };

  const scenario = {
    admin: apiAs(app, admin.accessToken),
    adminId: admin.userId,
    ana: apiAs(app, ana.accessToken),
    anaId: ana.userId,
    juan: apiAs(app, juan.accessToken),
    juanId: juan.userId,
    luis: apiAs(app, luis.accessToken),
    luisId: luis.userId,
    manager: apiAs(app, manager.accessToken, s1.branchId),
    /** El mismo gerente trabajando en S2. */
    managerS2: apiAs(app, manager.accessToken, s2.branchId),
    managerId: manager.userId,
    clerk: apiAs(app, clerk.accessToken),
    s1,
    s2,
    racks: {
      a1: a.rackIds['A-01-01']!,
      a2: a.rackIds['A-01-02']!,
      staging: s1.staging.rackId,
      b1: b.rackIds['B-01-01']!,
    },
    registers: { S1: await registers('S1'), S2: await registers('S2') },
    shoeProductId: shoeProduct.id,
    shoe: shoe.id,
    beltProductId: beltProduct.id,
    belt: belt.id,
  };
  await restock(prisma, scenario);
  return scenario;
}

export type PosScenario = Awaited<ReturnType<typeof setupPos>>;

/** Stock inicial: zapato 10 en A-01-01 y 3 en staging de S1, 2 en B-01-01 de S2; cinturón 10. */
async function restock(
  prisma: PrismaClient,
  pos: Pick<PosScenario, 'adminId' | 'racks' | 'shoe' | 'belt'>,
) {
  const put = (variantId: string, rackId: string, quantity: number) =>
    putStock(prisma, { variantId, rackId, quantity, userId: pos.adminId });
  await put(pos.shoe, pos.racks.a1, 10);
  await put(pos.shoe, pos.racks.staging, 3);
  await put(pos.shoe, pos.racks.b1, 2);
  await put(pos.belt, pos.racks.a2, 10);
}

/**
 * Deja el POS como recién sembrado sin volver a iniciar sesión (el login tiene rate limit):
 * sin sesiones, carritos, ventas, movimientos ni audit, folios en 0, precios e IVA originales y
 * el stock inicial.
 */
export async function resetPos(prisma: PrismaClient, pos: PosScenario) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE payment, sale_item, sale, cart_item, cart, cash_session, inventory_movement, stock_location, audit_log',
  );
  await prisma.branchCounter.updateMany({ data: { value: 0 } });
  await prisma.branch.updateMany({ data: { taxRateBp: 1600, pricesIncludeTax: true } });
  await prisma.product.update({
    where: { id: pos.shoeProductId },
    data: { price: SHOE_PRICE, isActive: true },
  });
  await prisma.product.update({
    where: { id: pos.beltProductId },
    data: { price: BELT_PRICE, isActive: true },
  });
  await prisma.productVariant.updateMany({ data: { isActive: true, priceOverride: null } });
  await restock(prisma, pos);
}

export async function openSession(api: Api, cashRegisterId: string, openingAmount = 50000) {
  return expectStatus<PosSessionDto>(
    await api.post('/pos/cash-sessions/open', { cashRegisterId, openingAmount }),
    201,
  );
}

/**
 * Carrito nuevo del usuario (o su activo vacío, que se reutiliza) con las partidas indicadas
 * `[variante, rack, cantidad]`.
 */
export async function cartWith(api: Api, items: [string, string, number?][] = [], body = {}) {
  const res = await api.post('/pos/carts', body);
  let cart = expectStatus<CartDetailDto>(res, res.statusCode === 200 ? 200 : 201);
  for (const [variantId, sourceRackId, quantity = 1] of items) {
    cart = expectStatus<CartDetailDto>(
      await api.post(`/pos/carts/${cart.id}/items`, { variantId, sourceRackId, quantity }),
      201,
    );
  }
  return cart;
}

/** Cobra todo en efectivo (exacto o con `received`) y verifica todas las piezas. */
export async function payCash(
  api: Api,
  cart: CartDetailDto,
  cashSessionId: string,
  received?: number,
) {
  const total = cart.totals.total;
  const units = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  return expectStatus<SaleTicketDto>(
    await api.post(`/pos/carts/${cart.id}/checkout`, {
      cashSessionId,
      payments:
        total === 0 ? [] : [{ method: 'CASH', amount: total, ...(received ? { received } : {}) }],
      verifiedUnits: units,
    }),
    201,
  );
}

/** Existencia y reservadas de una variante en un rack. */
export async function stockOf(prisma: PrismaClient, variantId: string, rackId: string) {
  const row = await prisma.stockLocation.findUnique({
    where: { variantId_rackId: { variantId, rackId } },
    select: { quantity: true, reservedQty: true },
  });
  return row ?? { quantity: 0, reservedQty: 0 };
}
