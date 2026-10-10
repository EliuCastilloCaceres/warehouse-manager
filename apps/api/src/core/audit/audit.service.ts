import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface AuditEntry {
  userId?: string | null;
  action: string; // "auth.login"
  entity: string; // "User"
  entityId?: string | null;
  payload?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Registra acciones sensibles en `audit_log`; dentro de un `tx`, se revierte con él. */
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        payload: entry.payload,
        ip: entry.ip ?? null,
      },
    });
  }
}
