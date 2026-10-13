import type {
  BranchDto,
  BranchUpdateInput,
  CashRegisterDto,
  CashRegisterUpdateInput,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import { Prisma } from '../../generated/prisma/client.js';
import * as repo from './settings.repository.js';
import type { BranchRow, CashRegisterRow } from './settings.repository.js';

/** Quien actúa: sus sucursales salen de los claims (spec F2 §2) y la ip va al audit. */
export interface SettingsActor {
  userId: string;
  branchIds: readonly string[];
  ip: string | null;
}

type Changes = Record<string, { from: unknown; to: unknown }>;

function toBranchDto(row: BranchRow): BranchDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toCashRegisterDto(row: CashRegisterRow): CashRegisterDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Campos del `PATCH` cuyo valor difiere del actual, con el anterior y el nuevo. */
function changesOf<T extends object>(current: T, input: Partial<T>): Changes {
  const changes: Changes = {};
  for (const [field, to] of Object.entries(input)) {
    const from = current[field as keyof T];
    if (to !== undefined && to !== from) changes[field] = { from, to };
  }
  return changes;
}

const valuesOf = (changes: Changes) =>
  Object.fromEntries(Object.entries(changes).map(([field, { to }]) => [field, to]));

const duplicateCode = () =>
  new DomainError('CONFLICT', {
    message: 'Ya existe una caja con ese código.',
    details: { target: ['code'] },
  });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Datos de la sucursal y cajas (spec F5). */
export class SettingsService {
  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async getBranch(actor: SettingsActor, id: string): Promise<BranchDto> {
    return toBranchDto(await this.loadBranch(actor, id));
  }

  /** Solo escribe y audita si algún valor cambia; gana la última escritura. */
  async updateBranch(
    actor: SettingsActor,
    id: string,
    input: BranchUpdateInput,
  ): Promise<BranchDto> {
    const current = await this.loadBranch(actor, id);
    const changes = changesOf(current, input);
    if (Object.keys(changes).length === 0) return toBranchDto(current);
    const row = await this.prisma.$transaction(async (tx) => {
      const row = await repo.updateBranch(tx, id, valuesOf(changes));
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'branch.update',
          entity: 'Branch',
          entityId: id,
          payload: { changes } as Prisma.InputJsonObject,
          ip: actor.ip,
        },
        tx,
      );
      return row;
    });
    return toBranchDto(row);
  }

  /** Cajas de la sucursal de la petición, por código. */
  async listCashRegisters(branchId: string): Promise<CashRegisterDto[]> {
    const rows = await repo.listCashRegisters(this.prisma, branchId);
    return rows.map(toCashRegisterDto);
  }

  async getCashRegister(actor: SettingsActor, id: string): Promise<CashRegisterDto> {
    return toCashRegisterDto(await this.loadCashRegister(actor, id));
  }

  async updateCashRegister(
    actor: SettingsActor,
    id: string,
    input: CashRegisterUpdateInput,
  ): Promise<CashRegisterDto> {
    const current = await this.loadCashRegister(actor, id);
    const changes = changesOf(current, input);
    if (Object.keys(changes).length === 0) return toCashRegisterDto(current);
    // El código es único por sucursal (índice de F1): un duplicado llega como P2002.
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const row = await repo.updateCashRegister(tx, id, valuesOf(changes));
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'cash_register.update',
            entity: 'CashRegister',
            entityId: id,
            payload: { changes } as Prisma.InputJsonObject,
            ip: actor.ip,
          },
          tx,
        );
        return row;
      });
      return toCashRegisterDto(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateCode();
      throw error;
    }
  }

  /**
   * La sucursal debe estar en los claims del actor; si no → 403 `BRANCH_FORBIDDEN`, también si
   * el id no existe, para no revelar qué ids existen.
   */
  private async loadBranch(actor: SettingsActor, id: string): Promise<BranchRow> {
    if (!actor.branchIds.includes(id)) throw new DomainError('BRANCH_FORBIDDEN');
    return repo.getBranch(this.prisma, id);
  }

  /** Inexistente → 404; de una sucursal fuera de los claims del actor → 403. */
  private async loadCashRegister(actor: SettingsActor, id: string): Promise<CashRegisterRow> {
    const row = await repo.findCashRegister(this.prisma, id);
    if (!row) throw new DomainError('NOT_FOUND', { message: 'La caja no existe.' });
    if (!actor.branchIds.includes(row.branchId)) throw new DomainError('BRANCH_FORBIDDEN');
    return row;
  }
}
