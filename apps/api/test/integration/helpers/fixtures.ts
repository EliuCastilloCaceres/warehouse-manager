import type { PrismaClient } from '../../../src/core/prisma-client.js';

/** Ids del grafo base: una fila válida en cada tabla con restricciones. */
export interface BaseGraph {
  roleId: string;
  userId: string;
  otherUserId: string;
  branchId: string;
  otherBranchId: string;
  registerId: string;
  otherRegisterId: string;
  sessionId: string;
  warehouseId: string;
  otherWarehouseId: string;
  zoneId: string;
  containerId: string;
  rackId: string;
  otherRackId: string;
  categoryId: string;
  brandId: string;
  productId: string;
  variantId: string;
  stockLocationId: string;
  movementId: string;
  cartId: string;
  cartItemId: string;
  saleId: string;
  saleItemId: string;
  paymentId: string;
}

let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}`;

/** Crea el grafo base con el cliente de Prisma (así también se prueba el "caso válido" de cada tabla). */
export async function createBaseGraph(prisma: PrismaClient): Promise<BaseGraph> {
  const role = await prisma.role.create({ data: { code: unique('ROLE'), name: 'Rol de prueba' } });
  const user = await prisma.user.create({
    data: { username: unique('user'), passwordHash: 'x', fullName: 'Usuario', roleId: role.id },
  });
  const otherUser = await prisma.user.create({
    data: { username: unique('user'), passwordHash: 'x', fullName: 'Otro', roleId: role.id },
  });
  const branch = await prisma.branch.create({ data: { code: unique('B'), name: 'Sucursal' } });
  const otherBranch = await prisma.branch.create({ data: { code: unique('B'), name: 'Otra' } });
  await prisma.branchCounter.create({ data: { branchId: branch.id, key: 'SALE_FOLIO' } });
  const register = await prisma.cashRegister.create({
    data: { branchId: branch.id, code: 'C1', name: 'Caja 1' },
  });
  const otherRegister = await prisma.cashRegister.create({
    data: { branchId: branch.id, code: 'C2', name: 'Caja 2' },
  });
  const session = await prisma.cashSession.create({
    data: { cashRegisterId: register.id, openedById: user.id, openingAmount: 50000 },
  });

  const warehouse = await prisma.warehouse.create({
    data: { branchId: branch.id, code: 'ALM1', name: 'Almacén' },
  });
  const otherWarehouse = await prisma.warehouse.create({
    data: { branchId: otherBranch.id, code: 'ALM1', name: 'Almacén' },
  });
  const zone = await prisma.zone.create({
    data: { warehouseId: warehouse.id, code: 'A', name: 'Zona A', color: '#2563EB' },
  });
  const container = await prisma.container.create({ data: { zoneId: zone.id, code: '01' } });
  const rack = await prisma.rack.create({
    data: {
      containerId: container.id,
      warehouseId: warehouse.id,
      code: '01',
      locationCode: 'A-01-01',
      capacityUnits: 40,
      labelColor: '#16A34A',
    },
  });
  const otherRack = await prisma.rack.create({
    data: {
      containerId: container.id,
      warehouseId: warehouse.id,
      code: '02',
      locationCode: 'A-01-02',
      capacityUnits: 40,
    },
  });

  const category = await prisma.category.create({ data: { name: unique('Categoría') } });
  const brand = await prisma.brand.create({ data: { name: unique('Marca') } });
  const product = await prisma.product.create({
    data: {
      sku: unique('ZAP'),
      name: 'Zapato',
      type: 'VARIABLE',
      price: 89900,
      cost: 45000,
      categoryId: category.id,
      brandId: brand.id,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: unique('ZAPV'), size: '25', color: 'Negro' },
  });
  const stock = await prisma.stockLocation.create({
    data: { variantId: variant.id, rackId: rack.id, quantity: 5, reservedQty: 1 },
  });
  const movement = await prisma.inventoryMovement.create({
    data: {
      variantId: variant.id,
      toRackId: rack.id,
      quantity: 5,
      type: 'PUTAWAY',
      userId: user.id,
    },
  });

  const cart = await prisma.cart.create({
    data: { branchId: branch.id, userId: user.id, number: 1, status: 'CHECKED_OUT' },
  });
  const cartItem = await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      variantId: variant.id,
      sourceRackId: rack.id,
      quantity: 1,
      unitPrice: 1000,
    },
  });
  const sale = await prisma.sale.create({
    data: {
      folio: unique('F-'),
      branchId: branch.id,
      cashRegisterId: register.id,
      cashSessionId: session.id,
      sellerId: user.id,
      cashierId: user.id,
      cartId: cart.id,
      subtotal: 1000,
      discountTotal: 0,
      taxRateBp: 1600,
      pricesIncludeTax: true,
      taxTotal: 138,
      total: 1000,
    },
  });
  const saleItem = await prisma.saleItem.create({
    data: {
      saleId: sale.id,
      variantId: variant.id,
      sourceRackId: rack.id,
      skuSnapshot: variant.sku,
      nameSnapshot: product.name,
      variantLabelSnapshot: '25 · Negro',
      unitPrice: 1000,
      quantity: 1,
      lineTotal: 1000,
    },
  });
  const payment = await prisma.payment.create({
    data: { saleId: sale.id, method: 'CASH', amount: 1000, received: 1000, change: 0 },
  });

  return {
    roleId: role.id,
    userId: user.id,
    otherUserId: otherUser.id,
    branchId: branch.id,
    otherBranchId: otherBranch.id,
    registerId: register.id,
    otherRegisterId: otherRegister.id,
    sessionId: session.id,
    warehouseId: warehouse.id,
    otherWarehouseId: otherWarehouse.id,
    zoneId: zone.id,
    containerId: container.id,
    rackId: rack.id,
    otherRackId: otherRack.id,
    categoryId: category.id,
    brandId: brand.id,
    productId: product.id,
    variantId: variant.id,
    stockLocationId: stock.id,
    movementId: movement.id,
    cartId: cart.id,
    cartItemId: cartItem.id,
    saleId: sale.id,
    saleItemId: saleItem.id,
    paymentId: payment.id,
  };
}
