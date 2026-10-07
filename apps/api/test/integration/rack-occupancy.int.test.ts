import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';
import { createBaseGraph, type BaseGraph } from './helpers/fixtures.js';

interface OccupancyRow {
  rack_id: string;
  zone_id: string;
  warehouse_id: string;
  location_code: string;
  is_staging: boolean;
  capacity_units: number;
  occupied_units: number;
  reserved_units: number;
  free_units: number;
}

describe('vista v_rack_occupancy (T20)', () => {
  let prisma: PrismaClient;
  let g: BaseGraph;

  beforeAll(async () => {
    prisma = createTestClient();
    await truncateAll(prisma);
    g = await createBaseGraph(prisma);
    // g.rackId ya tiene 5/1 de g.variantId; se agrega otra variante con 3/0.
    const variant = await prisma.productVariant.create({
      data: { productId: g.productId, sku: 'OCC-2', size: '26', color: 'Negro' },
    });
    await prisma.stockLocation.create({
      data: { variantId: variant.id, rackId: g.rackId, quantity: 3, reservedQty: 0 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = async (rackId: string) => {
    const rows = await prisma.$queryRaw<OccupancyRow[]>`
      SELECT * FROM v_rack_occupancy WHERE rack_id = ${rackId}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  it('suma cantidades y reservas del rack', async () => {
    expect(await row(g.rackId)).toMatchObject({
      zone_id: g.zoneId,
      warehouse_id: g.warehouseId,
      location_code: 'A-01-01',
      is_staging: false,
      capacity_units: 40,
      occupied_units: 8,
      reserved_units: 1,
      free_units: 32,
    });
  });

  it('un rack sin stock da 0/0/capacidad', async () => {
    expect(await row(g.otherRackId)).toMatchObject({
      occupied_units: 0,
      reserved_units: 0,
      free_units: 40,
    });
  });
});
