import { BranchDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { createSaleFixture } from './helpers/sales.js';
import { resetWithSeed } from './helpers/seed.js';

/** UUID con formato válido para armar URLs de imagen de otra entidad. */
const SOME_UUID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('sucursal en Ajustes (T6–T10)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let s1: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    s1 = (await prisma.branch.findUniqueOrThrow({ where: { code: 'S1' } })).id;
    const admin = await loginSeeded(app, prisma, 'admin');
    adminToken = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const get = (id: string, token = adminToken) =>
    app.inject({ method: 'GET', url: `/api/v1/branches/${id}`, headers: bearer(token) });
  const patch = (payload: Record<string, unknown>, id = s1, token = adminToken) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/branches/${id}`,
      headers: bearer(token),
      payload,
    });
  const branchAudits = () => prisma.auditLog.count({ where: { action: 'branch.update' } });

  describe('GET /branches/:id (T6)', () => {
    it('OWNER y ADMIN → 200 BranchDto', async () => {
      const owner = await loginSeeded(app, prisma, 'owner');
      for (const token of [owner.accessToken, adminToken]) {
        const res = await get(s1, token);
        expect(res.statusCode).toBe(200);
        expect(BranchDto.parse(res.json())).toMatchObject({ id: s1, code: 'S1' });
      }
    });

    it('un SELLER con settings.branch extra → 200; sin él → 403 FORBIDDEN', async () => {
      const withExtra = await createAndLogin(app, prisma, {
        username: 'vende-ajustes',
        extraPermissions: ['settings.branch'],
      });
      expect((await get(s1, withExtra.accessToken)).statusCode).toBe(200);

      const seller = await createAndLogin(app, prisma, { username: 'vende' });
      const res = await get(s1, seller.accessToken);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'settings.branch' },
      });
    });

    it('una sucursal no asignada o inexistente → 403 BRANCH_FORBIDDEN; id no UUID → 400', async () => {
      const other = await prisma.branch.create({ data: { code: 'S9', name: 'Otra' } });
      const manager = await createAndLogin(app, prisma, {
        username: 'gerente-s1',
        role: 'MANAGER',
        branches: ['S1'],
      });
      for (const id of [other.id, '00000000-0000-4000-8000-000000000000']) {
        const res = await get(id, manager.accessToken);
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('BRANCH_FORBIDDEN');
      }
      const invalid = await get('no-es-uuid');
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /branches/:id (T7)', () => {
    it('cambia los datos y responde el BranchDto nuevo; repetirlo no escribe', async () => {
      const before = BranchDto.parse((await get(s1)).json());
      const payload = {
        name: 'Sucursal Centro',
        legalName: 'Calzado Ejemplo SA de CV',
        taxId: 'cej010101ab1',
        address: 'Av. Siempre Viva 123',
        phone: '55 1234 5678',
        email: 'centro@ejemplo.mx',
        ticketHeader: '¡Bienvenido!',
        ticketFooterMessage: 'Gracias por su compra',
        promoQrText: 'DESC10',
        promoQrCaption: 'Muestra este QR en tu próxima compra',
        timezone: 'America/Monterrey',
        taxRateBp: 800,
        pricesIncludeTax: false,
        lowStockThreshold: 5,
      };
      const res = await patch(payload);
      expect(res.statusCode).toBe(200);
      const after = BranchDto.parse(res.json());
      expect(after).toMatchObject({ ...payload, taxId: 'CEJ010101AB1', code: 'S1' });
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
        new Date(before.updatedAt).getTime(),
      );

      const audits = await branchAudits();
      const again = await patch(payload);
      expect(again.statusCode).toBe(200);
      expect(again.json().updatedAt).toBe(after.updatedAt);
      expect(await branchAudits()).toBe(audits);
    });

    it('"" en legalName guarda null', async () => {
      const res = await patch({ legalName: '' });
      expect(res.statusCode).toBe(200);
      expect(res.json().legalName).toBeNull();
      const row = await prisma.branch.findUniqueOrThrow({ where: { id: s1 } });
      expect(row.legalName).toBeNull();
    });
  });

  describe('PATCH inválido (T8)', () => {
    it.each([
      ['code', { code: 'S7' }, undefined],
      ['currency', { currency: 'USD' }, undefined],
      ['isActive', { isActive: false }, undefined],
      ['timezone inválida', { timezone: 'Mars/Phobos' }, 'timezone'],
      ['logoUrl de producto', { logoUrl: `/uploads/product/${SOME_UUID}.webp` }, 'logoUrl'],
      ['logoUrl externa', { logoUrl: 'https://x.com/logo.webp' }, 'logoUrl'],
      ['taxRateBp 10001', { taxRateBp: 10001 }, 'taxRateBp'],
    ])('%s → 400 sin escribir', async (_caso, payload, path) => {
      const before = await prisma.branch.findUniqueOrThrow({ where: { id: s1 } });
      const audits = await branchAudits();
      const res = await patch(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      if (path) {
        expect(res.json().details).toEqual(
          expect.arrayContaining([expect.objectContaining({ path })]),
        );
      }
      expect(await prisma.branch.findUniqueOrThrow({ where: { id: s1 } })).toEqual(before);
      expect(await branchAudits()).toBe(audits);
    });
  });

  describe('audit (T9)', () => {
    it('branch.update guarda solo los campos que cambiaron', async () => {
      const before = await prisma.branch.findUniqueOrThrow({ where: { id: s1 } });
      const res = await patch({ name: 'Sucursal Norte', taxRateBp: 1600, phone: before.phone });
      expect(res.statusCode).toBe(200);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'branch.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toMatchObject({
        userId: adminId,
        entity: 'Branch',
        entityId: s1,
        payload: {
          changes: {
            name: { from: before.name, to: 'Sucursal Norte' },
            taxRateBp: { from: before.taxRateBp, to: 1600 },
          },
        },
      });
      expect(Object.keys((log.payload as { changes: object }).changes)).toEqual([
        'name',
        'taxRateBp',
      ]);
      expect(log.ip).toEqual(expect.any(String));
    });
  });

  describe('ventas guardadas (T10)', () => {
    it('cambiar el IVA no cambia una venta existente', async () => {
      await patch({ taxRateBp: 1600, pricesIncludeTax: true });
      const sale = await createSaleFixture(prisma, { userId: adminId });

      const res = await patch({ taxRateBp: 800, pricesIncludeTax: false });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      expect(stored).toEqual(sale);
      expect(stored).toMatchObject({ taxRateBp: 1600, pricesIncludeTax: true });
    });
  });
});
