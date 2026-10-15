import type { CartStatus } from '@warehouse-manager/shared';
import { DomainError } from '../../core/errors.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

/** Carritos que todavía se pueden editar o cobrar. */
export const OPEN_CART_STATUSES: CartStatus[] = ['ACTIVE', 'SUSPENDED'];

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Bloquea la fila de la sucursal (spec F8 §3): `UPDATE` al cerrar una caja o liberar todos los
 * carritos; `SHARE` al abrir caja, crear carritos y agregar partidas. Siempre es el primer
 * bloqueo de la transacción (sucursal → sesión → carrito → stock → folio), para no cruzarse.
 */
export async function lockBranch(tx: Tx, branchId: string, mode: 'UPDATE' | 'SHARE') {
  if (mode === 'UPDATE') {
    await tx.$executeRaw`SELECT 1 FROM branch WHERE id = ${branchId}::uuid FOR UPDATE`;
  } else {
    await tx.$executeRaw`SELECT 1 FROM branch WHERE id = ${branchId}::uuid FOR SHARE`;
  }
}

/** Bloqueo transaccional con nombre (se libera al terminar la transacción). */
export async function advisoryLock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Bloquea la sesión de caja: `SHARE` al cobrar o cancelar y `UPDATE` al cerrarla. */
export async function lockSession(tx: Tx, sessionId: string, mode: 'UPDATE' | 'SHARE') {
  if (mode === 'UPDATE') {
    await tx.$executeRaw`SELECT 1 FROM cash_session WHERE id = ${sessionId}::uuid FOR UPDATE`;
  } else {
    await tx.$executeRaw`SELECT 1 FROM cash_session WHERE id = ${sessionId}::uuid FOR SHARE`;
  }
}

export async function lockCart(tx: Tx, cartId: string) {
  await tx.$executeRaw`SELECT 1 FROM cart WHERE id = ${cartId}::uuid FOR UPDATE`;
}

export async function lockSale(tx: Tx, saleId: string) {
  await tx.$executeRaw`SELECT 1 FROM sale WHERE id = ${saleId}::uuid FOR UPDATE`;
}

/** Sesiones abiertas de las cajas de la sucursal (opcionalmente sin contar una). */
export function countOpenSessions(db: Db, branchId: string, exceptId?: string) {
  return db.cashSession.count({
    where: {
      status: 'OPEN',
      cashRegister: { branchId },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}

/** Sin ninguna caja abierta en la sucursal no se crean carritos ni se agregan partidas. */
export async function assertOpenSessionInBranch(tx: Tx, branchId: string) {
  if ((await countOpenSessions(tx, branchId)) === 0) {
    throw new DomainError('NO_OPEN_CASH_SESSION');
  }
}

/** Menor número libre (1–999) entre los carritos abiertos de la sucursal. */
export async function nextCartNumber(tx: Tx, branchId: string): Promise<number> {
  await advisoryLock(tx, `pos.cart.number:${branchId}`);
  const [row] = await tx.$queryRaw<{ n: number }[]>`
    SELECT n::int AS n FROM generate_series(1, 999) AS n
    WHERE NOT EXISTS (
      SELECT 1 FROM cart c
      WHERE c.branch_id = ${branchId}::uuid AND c.number = n
        AND c.status IN ('ACTIVE', 'SUSPENDED')
    )
    ORDER BY n LIMIT 1`;
  if (!row) {
    throw new DomainError('CONFLICT', {
      message: 'No hay números de carrito libres; cobra o descarta algún carrito.',
    });
  }
  return row.n;
}

/** Siguiente folio de la sucursal; si el cobro falla, la transacción lo revierte. */
export async function nextSaleFolio(tx: Tx, branchId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO branch_counter (branch_id, key, value, updated_at)
    VALUES (${branchId}::uuid, 'SALE_FOLIO', 1, now())
    ON CONFLICT (branch_id, key)
    DO UPDATE SET value = branch_counter.value + 1, updated_at = now()
    RETURNING value`;
  return row!.value;
}

const firstImage = {
  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  take: 1,
  select: { thumbUrl: true },
} satisfies Prisma.ProductImageFindManyArgs;

/** Carrito con su dueño y sus partidas listas para `CartDetailDto`. */
export function findCartDetail(db: Db, id: string) {
  return db.cart.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true } },
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          variant: {
            include: {
              images: firstImage,
              product: { select: { name: true, images: firstImage } },
            },
          },
          sourceRack: {
            select: { locationCode: true, container: { select: { zone: true } } },
          },
        },
      },
    },
  });
}

export type CartDetailRow = NonNullable<Awaited<ReturnType<typeof findCartDetail>>>;

/** Partida con su rack de origen (para liberar la reserva). */
export function findCartItem(db: Db, itemId: string) {
  return db.cartItem.findUnique({
    where: { id: itemId },
    include: {
      sourceRack: {
        select: { id: true, locationCode: true, container: { select: { zone: true } } },
      },
    },
  });
}

export type CartItemRow = NonNullable<Awaited<ReturnType<typeof findCartItem>>>;

/** Datos de la sucursal que intervienen en los totales. */
export function taxSettingsOf(db: Db, branchId: string) {
  return db.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { code: true, taxRateBp: true, pricesIncludeTax: true },
  });
}
