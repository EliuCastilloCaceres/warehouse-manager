import { AuditService } from '../../src/core/audit/audit.service.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

describe('AuditService (T29)', () => {
  let prisma: PrismaClient;
  let audit: AuditService;
  let userId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    audit = new AuditService(prisma);
    userId = (await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('record guarda todos los campos', async () => {
    await audit.record({
      userId,
      action: 'user.create',
      entity: 'User',
      entityId: userId,
      payload: { campo: 'valor' },
      ip: '10.0.0.5',
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.create' } });
    expect(row).toMatchObject({
      userId,
      action: 'user.create',
      entity: 'User',
      entityId: userId,
      payload: { campo: 'valor' },
      ip: '10.0.0.5',
    });
  });

  it('dentro de un tx que luego falla, no queda la fila', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record({ action: 'test.rollback', entity: 'Test' }, tx);
        throw new Error('falla después de auditar');
      }),
    ).rejects.toThrow('falla después de auditar');
    expect(await prisma.auditLog.count({ where: { action: 'test.rollback' } })).toBe(0);
  });
});
