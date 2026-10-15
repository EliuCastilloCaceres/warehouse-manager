import type { LocateResultDto, NodeContentDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { cartWith, expectStatus, openSession, type PosScenario, setupPos } from './helpers/pos.js';
import { type Api, apiAs } from './helpers/warehouse.js';

describe('buscar para vender (T20)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pos: PosScenario;
  let posOnly: Api;

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    pos = await setupPos(prisma, app);
    await prisma.branch.update({ where: { id: pos.s2.branchId }, data: { phone: '55 1234 5678' } });
    // Rol propio con solo `pos.sell`: sin `warehouse.read` ni `inventory.other_branches.read`.
    const sell = await prisma.permission.findUniqueOrThrow({ where: { code: 'pos.sell' } });
    await prisma.role.create({
      data: {
        code: 'SOLO_POS',
        name: 'Solo POS',
        permissions: { create: [{ permissionId: sell.id }] },
      },
    });
    const session = await createAndLogin(app, prisma, {
      username: 'cajera',
      role: 'SOLO_POS' as never,
    });
    posOnly = apiAs(app, session.accessToken);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('por SKU de variante y por SKU padre, con ubicaciones, reservas y otras sucursales', async () => {
    const byVariant = expectStatus<LocateResultDto>(
      await pos.ana.get('/pos/lookup?code=zap0101-25-neg'),
      200,
    );
    expect(byVariant.product).toMatchObject({ sku: 'ZAP0101', name: 'Zapato de piel dama' });
    expect(byVariant.variants).toHaveLength(1);
    const [shoe] = byVariant.variants;
    expect(shoe!.variant).toMatchObject({ sku: 'ZAP0101-25-NEG', effectivePrice: 89900 });
    expect(shoe!.locations.map((l) => [l.locationCode, l.available, l.isStaging])).toEqual([
      ['A-01-01', 10, false],
      ['STG-01-01', 3, true],
    ]);
    // El Vendedor tiene `inventory.other_branches.read`.
    expect(shoe!.otherBranches).toEqual([
      expect.objectContaining({ code: 'S2', phone: '55 1234 5678', available: 2 }),
    ]);

    const byBarcode = expectStatus<LocateResultDto>(
      await pos.ana.get('/pos/lookup?code=7501234567890'),
      200,
    );
    expect(byBarcode.variants[0]!.variant.id).toBe(pos.shoe);
    const byParent = expectStatus<LocateResultDto>(
      await pos.ana.get('/pos/lookup?code=ZAP0101'),
      200,
    );
    expect(byParent.variants.map((v) => v.variant.sku)).toEqual(['ZAP0101-25-NEG']);
    expect((await pos.ana.get('/pos/lookup?code=NOEXISTE')).statusCode).toBe(404);

    // Sin `warehouse.read` también busca; sin permiso de otras sucursales, `null`.
    const restricted = expectStatus<LocateResultDto>(
      await posOnly.get('/pos/lookup?code=ZAP0101-25-NEG'),
      200,
    );
    expect(restricted.variants[0]!.otherBranches).toBeNull();
    expect((await posOnly.get('/inventory/locate?code=ZAP0101-25-NEG')).statusCode).toBe(403);

    // Una unidad en el carrito: 1 reservada aquí y "en piso" en el almacén (F7).
    await openSession(pos.luis, pos.registers.S1.C1);
    await cartWith(pos.ana, [[pos.shoe, pos.racks.a1]]);
    const after = expectStatus<LocateResultDto>(
      await pos.ana.get('/pos/lookup?code=ZAP0101-25-NEG'),
      200,
    );
    expect(after.variants[0]!.locations[0]).toMatchObject({
      locationCode: 'A-01-01',
      quantity: 10,
      reservedQty: 1,
      available: 9,
    });
    const onFloor = expectStatus<NodeContentDto>(
      await pos.ana.get(`/racks/${pos.racks.a1}?status=EN_PISO`),
      200,
    );
    expect(onFloor.items.map((row) => [row.sku, row.reservedQty])).toEqual([['ZAP0101-25-NEG', 1]]);
  });
});
