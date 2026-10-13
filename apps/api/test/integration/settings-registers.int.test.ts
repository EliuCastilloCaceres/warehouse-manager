import { CashRegisterDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';

describe('cajas en Ajustes (T11–T13)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  const ids = { s1: '', s2: '', s1c1: '', s1c2: '', s2c1: '' };

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const registers = await prisma.cashRegister.findMany({ include: { branch: true } });
    const find = (branch: string, code: string) =>
      registers.find((r) => r.branch.code === branch && r.code === code)!;
    ids.s1 = find('S1', 'C1').branchId;
    ids.s2 = find('S2', 'C1').branchId;
    ids.s1c1 = find('S1', 'C1').id;
    ids.s1c2 = find('S1', 'C2').id;
    ids.s2c1 = find('S2', 'C1').id;
    const manager = await createAndLogin(app, prisma, {
      username: 'gerente-s1',
      role: 'MANAGER',
      branches: ['S1'],
    });
    token = manager.accessToken;
    userId = manager.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const call = (
    method: 'GET' | 'PATCH',
    path: string,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1/cash-registers${path}`,
      headers: { ...bearer(token), ...headers },
      ...(payload ? { payload } : {}),
    });

  describe('GET /cash-registers (T11)', () => {
    it('devuelve las cajas de la sucursal actual ordenadas por código', async () => {
      const res = await call('GET', '');
      expect(res.statusCode).toBe(200);
      const rows = CashRegisterDto.array().parse(res.json());
      expect(rows.map((r) => [r.code, r.branchId])).toEqual([
        ['C1', ids.s1],
        ['C2', ids.s1],
      ]);
      expect(rows.map((r) => r.id)).not.toContain(ids.s2c1);
    });

    it('X-Branch-Id de una sucursal no asignada → 403 BRANCH_FORBIDDEN', async () => {
      const res = await call('GET', '', undefined, { 'x-branch-id': ids.s2 });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('BRANCH_FORBIDDEN');
    });

    it('sin settings.registers → 403 FORBIDDEN', async () => {
      const seller = await createAndLogin(app, prisma, { username: 'vende' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cash-registers',
        headers: bearer(seller.accessToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'settings.registers' },
      });
    });
  });

  describe('GET /cash-registers/:id (T12)', () => {
    it('200 con la caja; inexistente → 404; de otra sucursal → 403', async () => {
      const ok = await call('GET', `/${ids.s1c1}`);
      expect(ok.statusCode).toBe(200);
      expect(CashRegisterDto.parse(ok.json())).toMatchObject({ id: ids.s1c1, code: 'C1' });

      const missing = await call('GET', '/00000000-0000-4000-8000-000000000000');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('NOT_FOUND');

      const foreign = await call('GET', `/${ids.s2c1}`);
      expect(foreign.statusCode).toBe(403);
      expect(foreign.json().code).toBe('BRANCH_FORBIDDEN');
    });
  });

  describe('PATCH /cash-registers/:id (T13)', () => {
    it('cambia nombre y código (en mayúsculas) y lo audita', async () => {
      const res = await call('PATCH', `/${ids.s1c1}`, { name: 'Caja principal', code: ' c3 ' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Caja principal', code: 'C3' });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'cash_register.update', entityId: ids.s1c1 },
      });
      expect(log).toMatchObject({
        userId,
        entity: 'CashRegister',
        payload: {
          changes: {
            name: { from: 'Caja 1', to: 'Caja principal' },
            code: { from: 'C1', to: 'C3' },
          },
        },
      });
    });

    it('el código de otra caja de la sucursal → 409 CONFLICT', async () => {
      const res = await call('PATCH', `/${ids.s1c1}`, { code: 'C2' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'CONFLICT',
        message: 'Ya existe una caja con ese código.',
      });
      expect(res.json().details.target).toContain('code');
      const row = await prisma.cashRegister.findUniqueOrThrow({ where: { id: ids.s1c1 } });
      expect(row.code).toBe('C3');
    });

    it('el mismo código que una caja de otra sucursal → 200', async () => {
      // S2 tiene C1; en S1 ya no hay C1 tras el cambio anterior.
      const res = await call('PATCH', `/${ids.s1c1}`, { code: 'C1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().code).toBe('C1');
    });

    it('sin cambios reales → 200 sin escribir ni auditar', async () => {
      const before = await prisma.cashRegister.findUniqueOrThrow({ where: { id: ids.s1c2 } });
      const audits = await prisma.auditLog.count({ where: { action: 'cash_register.update' } });
      const res = await call('PATCH', `/${ids.s1c2}`, { code: 'c2', name: 'Caja 2' });
      expect(res.statusCode).toBe(200);
      expect(res.json().updatedAt).toBe(before.updatedAt.toISOString());
      expect(await prisma.auditLog.count({ where: { action: 'cash_register.update' } })).toBe(
        audits,
      );
    });

    it('branchId en el body → 400', async () => {
      const res = await call('PATCH', `/${ids.s1c2}`, { branchId: ids.s2 });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      const row = await prisma.cashRegister.findUniqueOrThrow({ where: { id: ids.s1c2 } });
      expect(row.branchId).toBe(ids.s1);
    });
  });
});
