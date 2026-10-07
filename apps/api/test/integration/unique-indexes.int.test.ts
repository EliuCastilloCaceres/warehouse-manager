import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';
import { createBaseGraph, type BaseGraph } from './helpers/fixtures.js';

// T18: índices únicos especiales de la spec F1 §5.2.
describe('índices únicos especiales (T18)', () => {
  let prisma: PrismaClient;
  let g: BaseGraph;

  beforeAll(() => {
    prisma = createTestClient();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    g = await createBaseGraph(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cash_session_one_open_per_register: una sola sesión OPEN por caja', async () => {
    // g.sessionId ya está OPEN en g.registerId
    await expect(
      prisma.cashSession.create({
        data: { cashRegisterId: g.registerId, openedById: g.userId, openingAmount: 0 },
      }),
    ).rejects.toThrow();
    await prisma.cashSession.create({
      data: { cashRegisterId: g.otherRegisterId, openedById: g.userId, openingAmount: 0 },
    });
    await prisma.cashSession.create({
      data: {
        cashRegisterId: g.registerId,
        openedById: g.userId,
        openingAmount: 0,
        status: 'CLOSED',
        closedById: g.userId,
        closedAt: new Date(),
        expectedAmount: 0,
        countedAmount: 0,
        difference: 0,
      },
    });
  });

  it('user_branch_one_default: un solo isDefault por usuario', async () => {
    await prisma.userBranch.create({
      data: { userId: g.userId, branchId: g.branchId, isDefault: true },
    });
    await expect(
      prisma.userBranch.create({
        data: { userId: g.userId, branchId: g.otherBranchId, isDefault: true },
      }),
    ).rejects.toThrow();
    await prisma.userBranch.create({
      data: { userId: g.userId, branchId: g.otherBranchId, isDefault: false },
    });
  });

  it('cart_one_active_per_user_branch: un carrito ACTIVE por usuario y sucursal', async () => {
    const cart = (userId: string, branchId: string, number: number, status = 'ACTIVE' as const) =>
      prisma.cart.create({ data: { userId, branchId, number, status } });
    await cart(g.userId, g.branchId, 10);
    await expect(cart(g.userId, g.branchId, 11)).rejects.toThrow();
    await prisma.cart.create({
      data: { userId: g.userId, branchId: g.branchId, number: 12, status: 'SUSPENDED' },
    });
    await cart(g.otherUserId, g.branchId, 13);
    await cart(g.userId, g.otherBranchId, 14);
  });

  it('cart_number_open_per_branch: número único entre carritos abiertos', async () => {
    await prisma.cart.create({ data: { userId: g.userId, branchId: g.branchId, number: 7 } });
    await expect(
      prisma.cart.create({
        data: { userId: g.otherUserId, branchId: g.branchId, number: 7, status: 'SUSPENDED' },
      }),
    ).rejects.toThrow();
    // g.cartId (número 1) está CHECKED_OUT: el 1 se puede reutilizar
    await prisma.cart.create({ data: { userId: g.otherUserId, branchId: g.branchId, number: 1 } });
    await prisma.cart.create({
      data: { userId: g.otherUserId, branchId: g.branchId, number: 7, status: 'DISCARDED' },
    });
  });

  it('zone_one_staging_per_warehouse: una zona de staging por almacén', async () => {
    await prisma.zone.create({
      data: { warehouseId: g.warehouseId, code: 'STG', name: 'Staging', isStaging: true },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO zone (warehouse_id, code, name, is_staging, updated_at)
         VALUES ('${g.warehouseId}', 'STG', 'Otra', true, now())`,
      ),
    ).rejects.toThrow(/zone_one_staging_per_warehouse|zone_warehouse_id_code_key/);
    await prisma.zone.create({
      data: { warehouseId: g.otherWarehouseId, code: 'STG', name: 'Staging', isStaging: true },
    });
  });

  it('la segunda zona de staging falla aunque el código no se repita', async () => {
    await prisma.zone.create({
      data: { warehouseId: g.warehouseId, code: 'STG', name: 'Staging', isStaging: true },
    });
    // Sin la restricción zone_staging_code_check no habría otra forma de crearla: se prueba el índice directo.
    await prisma.$executeRawUnsafe('ALTER TABLE zone DROP CONSTRAINT zone_staging_code_check');
    try {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO zone (warehouse_id, code, name, is_staging, updated_at)
           VALUES ('${g.warehouseId}', 'B', 'B', true, now())`,
        ),
      ).rejects.toThrow('zone_one_staging_per_warehouse');
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE zone ADD CONSTRAINT zone_staging_code_check CHECK (is_staging = (code = 'STG'))`,
      );
    }
  });

  it('category_parent_id_name_key: categoría raíz duplicada falla (NULLS NOT DISTINCT)', async () => {
    await prisma.category.create({ data: { name: 'Calzado' } });
    await expect(prisma.category.create({ data: { name: 'Calzado' } })).rejects.toThrow();
    await prisma.category.create({ data: { name: 'Calzado', parentId: g.categoryId } });
  });

  it('product_variant_product_id_size_color_material_key: variante con atributos nulos duplicada falla', async () => {
    await prisma.productVariant.create({ data: { productId: g.productId, sku: 'DUP-1' } });
    await expect(
      prisma.productVariant.create({ data: { productId: g.productId, sku: 'DUP-2' } }),
    ).rejects.toThrow();
  });

  it('rack: el mismo locationCode falla en el mismo almacén y pasa en otro', async () => {
    const otherZone = await prisma.zone.create({
      data: { warehouseId: g.otherWarehouseId, code: 'A', name: 'Zona A' },
    });
    const otherContainer = await prisma.container.create({
      data: { zoneId: otherZone.id, code: '01' },
    });
    const zoneB = await prisma.zone.create({
      data: { warehouseId: g.warehouseId, code: 'B', name: 'Zona B' },
    });
    const containerB = await prisma.container.create({ data: { zoneId: zoneB.id, code: '01' } });
    await expect(
      prisma.rack.create({
        data: {
          containerId: containerB.id,
          warehouseId: g.warehouseId,
          code: '01',
          locationCode: 'A-01-01',
          capacityUnits: 10,
        },
      }),
    ).rejects.toThrow();
    await prisma.rack.create({
      data: {
        containerId: otherContainer.id,
        warehouseId: g.otherWarehouseId,
        code: '01',
        locationCode: 'A-01-01',
        capacityUnits: 10,
      },
    });
  });
});
