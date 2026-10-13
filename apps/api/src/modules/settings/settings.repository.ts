import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Sucursal por id; si no existe, Prisma lanza P2025 y la API responde 404. */
export function getBranch(db: Db, id: string) {
  return db.branch.findUniqueOrThrow({ where: { id } });
}

export type BranchRow = Awaited<ReturnType<typeof getBranch>>;

export function updateBranch(db: Db, id: string, data: Prisma.BranchUpdateInput) {
  return db.branch.update({ where: { id }, data });
}

export function listCashRegisters(db: Db, branchId: string) {
  return db.cashRegister.findMany({ where: { branchId }, orderBy: { code: 'asc' } });
}

export function findCashRegister(db: Db, id: string) {
  return db.cashRegister.findUnique({ where: { id } });
}

export type CashRegisterRow = NonNullable<Awaited<ReturnType<typeof findCashRegister>>>;

export function updateCashRegister(
  db: Db,
  id: string,
  data: Pick<Prisma.CashRegisterUpdateInput, 'code' | 'name'>,
) {
  return db.cashRegister.update({ where: { id }, data });
}
