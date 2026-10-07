import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient, truncateAll } from './helpers/db.js';
import { createBaseGraph, type BaseGraph } from './helpers/fixtures.js';

// T17: cada CHECK de la spec F1 §5.1 rechaza su caso inválido, nombrando la restricción.
describe('restricciones CHECK (T17)', () => {
  let prisma: PrismaClient;
  let g: BaseGraph;

  beforeAll(async () => {
    prisma = createTestClient();
    await truncateAll(prisma);
    // El grafo base inserta un caso válido en cada tabla con CHECK.
    g = await createBaseGraph(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const movement = (g: BaseGraph, cols: string, values: string) =>
    `INSERT INTO inventory_movement (variant_id, user_id, ${cols}) VALUES ('${g.variantId}', '${g.userId}', ${values})`;

  const cases: [string, (g: BaseGraph) => string][] = [
    [
      'branch_tax_rate_bp_check',
      (g) => `UPDATE branch SET tax_rate_bp = 10001 WHERE id = '${g.branchId}'`,
    ],
    [
      'branch_low_stock_threshold_check',
      (g) => `UPDATE branch SET low_stock_threshold = -1 WHERE id = '${g.branchId}'`,
    ],
    [
      'branch_currency_check',
      (g) => `UPDATE branch SET currency = 'mxn' WHERE id = '${g.branchId}'`,
    ],
    [
      'branch_counter_value_check',
      (g) => `UPDATE branch_counter SET value = -1 WHERE branch_id = '${g.branchId}'`,
    ],
    [
      'app_user_username_lower_check',
      (g) => `UPDATE app_user SET username = 'Admin' WHERE id = '${g.userId}'`,
    ],
    [
      'cash_session_amounts_check',
      (g) => `UPDATE cash_session SET opening_amount = -1 WHERE id = '${g.sessionId}'`,
    ],
    [
      'cash_session_status_check',
      (g) => `UPDATE cash_session SET status = 'CLOSED' WHERE id = '${g.sessionId}'`,
    ],
    [
      'cash_session_status_check',
      (g) =>
        `UPDATE cash_session SET status = 'CLOSED', closed_by_id = opened_by_id, closed_at = now(),
         expected_amount = 100, counted_amount = 90, difference = 5 WHERE id = '${g.sessionId}'`,
    ],
    ['product_sku_check', (g) => `UPDATE product SET sku = 'ab' WHERE id = '${g.productId}'`],
    ['product_amounts_check', (g) => `UPDATE product SET price = -1 WHERE id = '${g.productId}'`],
    [
      'product_variant_sku_check',
      (g) => `UPDATE product_variant SET sku = 'zap 01' WHERE id = '${g.variantId}'`,
    ],
    [
      'product_variant_price_override_check',
      (g) => `UPDATE product_variant SET price_override = -1 WHERE id = '${g.variantId}'`,
    ],
    ['zone_code_check', (g) => `UPDATE zone SET code = 'ABC' WHERE id = '${g.zoneId}'`],
    [
      'zone_staging_code_check',
      (g) => `UPDATE zone SET is_staging = true WHERE id = '${g.zoneId}'`,
    ],
    ['zone_color_check', (g) => `UPDATE zone SET color = '#abc123' WHERE id = '${g.zoneId}'`],
    [
      'container_code_check',
      (g) => `UPDATE container SET code = '00' WHERE id = '${g.containerId}'`,
    ],
    ['rack_code_check', (g) => `UPDATE rack SET code = '100' WHERE id = '${g.rackId}'`],
    [
      'rack_location_code_check',
      (g) => `UPDATE rack SET location_code = 'A-1-1' WHERE id = '${g.rackId}'`,
    ],
    ['rack_capacity_check', (g) => `UPDATE rack SET capacity_units = -1 WHERE id = '${g.rackId}'`],
    [
      'rack_label_color_check',
      (g) => `UPDATE rack SET label_color = 'red' WHERE id = '${g.rackId}'`,
    ],
    [
      'stock_location_qty_check',
      (g) => `UPDATE stock_location SET reserved_qty = 6 WHERE id = '${g.stockLocationId}'`,
    ],
    [
      'inventory_movement_qty_check',
      (g) => movement(g, 'type, to_rack_id, quantity', `'PUTAWAY', '${g.rackId}', 0`),
    ],
    [
      'inventory_movement_shape_check',
      (g) => movement(g, 'type, to_rack_id, quantity', `'PICK', '${g.rackId}', 1`),
    ],
    [
      'inventory_movement_shape_check',
      (g) =>
        movement(
          g,
          'type, from_rack_id, to_rack_id, quantity',
          `'RELOCATE', '${g.rackId}', '${g.rackId}', 1`,
        ),
    ],
    [
      'inventory_movement_reference_check',
      (g) =>
        movement(
          g,
          'type, to_rack_id, quantity, reference_type',
          `'PUTAWAY', '${g.rackId}', 1, 'CART'`,
        ),
    ],
    [
      'inventory_movement_adjustment_reason_check',
      (g) => movement(g, 'type, to_rack_id, quantity', `'ADJUSTMENT_IN', '${g.rackId}', 1`),
    ],
    [
      'inventory_movement_adjustment_reason_check',
      (g) =>
        movement(
          g,
          'type, to_rack_id, quantity, adjustment_reason',
          `'PUTAWAY', '${g.rackId}', 1, 'FOUND'`,
        ),
    ],
    ['cart_discount_check', (g) => `UPDATE cart SET discount = -1 WHERE id = '${g.cartId}'`],
    ['cart_number_check', (g) => `UPDATE cart SET number = 1000 WHERE id = '${g.cartId}'`],
    [
      'cart_item_amounts_check',
      (g) => `UPDATE cart_item SET discount = 1001 WHERE id = '${g.cartItemId}'`,
    ],
    ['sale_amounts_check', (g) => `UPDATE sale SET tax_rate_bp = 10001 WHERE id = '${g.saleId}'`],
    ['sale_total_check', (g) => `UPDATE sale SET total = 1001 WHERE id = '${g.saleId}'`],
    ['sale_cancel_check', (g) => `UPDATE sale SET status = 'CANCELLED' WHERE id = '${g.saleId}'`],
    ['sale_cancel_check', (g) => `UPDATE sale SET cancel_reason = 'x' WHERE id = '${g.saleId}'`],
    [
      'sale_item_amounts_check',
      (g) => `UPDATE sale_item SET line_total = 999 WHERE id = '${g.saleItemId}'`,
    ],
    [
      'payment_amount_check',
      (g) =>
        `UPDATE payment SET amount = 0, received = NULL, change = NULL WHERE id = '${g.paymentId}'`,
    ],
    ['payment_cash_check', (g) => `UPDATE payment SET change = 1 WHERE id = '${g.paymentId}'`],
    ['payment_cash_check', (g) => `UPDATE payment SET method = 'CARD' WHERE id = '${g.paymentId}'`],
  ];

  it.each(cases)('%s rechaza el caso inválido', async (constraint, buildSql) => {
    await expect(prisma.$executeRawUnsafe(buildSql(g))).rejects.toThrow(constraint);
  });

  it('cubre los 33 CHECK de la spec', () => {
    expect(new Set(cases.map(([name]) => name)).size).toBe(33);
  });

  it('acepta los casos válidos relacionados', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_movement (variant_id, user_id, type, to_rack_id, quantity, adjustment_reason)
       VALUES ('${g.variantId}', '${g.userId}', 'ADJUSTMENT_IN', '${g.rackId}', 1, 'FOUND')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_movement (variant_id, user_id, type, from_rack_id, to_rack_id, quantity)
       VALUES ('${g.variantId}', '${g.userId}', 'RELOCATE', '${g.rackId}', '${g.otherRackId}', 1)`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE cash_session SET status = 'CLOSED', closed_by_id = opened_by_id, closed_at = now(),
       expected_amount = 100, counted_amount = 90, difference = -10 WHERE id = '${g.sessionId}'`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE sale SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_id = '${g.userId}',
       cancel_reason = 'Prueba' WHERE id = '${g.saleId}'`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE payment SET method = 'CARD', received = NULL, change = NULL WHERE id = '${g.paymentId}'`,
    );
  });
});
