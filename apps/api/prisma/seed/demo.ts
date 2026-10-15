import { buildLocationCode } from '@warehouse-manager/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { emptySummary, type SeedSummary } from './summary.js';

type Tx = Prisma.TransactionClient;

export const BASE_SEED_MISSING = 'Ejecuta primero `pnpm db:seed`';

const ZONES = [
  { code: 'A', name: 'Zona A', color: '#2563EB', sortOrder: 1 },
  { code: 'B', name: 'Zona B', color: '#16A34A', sortOrder: 2 },
  { code: 'C', name: 'Zona C', color: '#DC2626', sortOrder: 3 },
];
const CONTAINERS = ['01', '02'];
const RACKS = ['01', '02', '03', '04'];
const RACK_CAPACITY = 40;
const BRANDS = ['Demo Calzado', 'Demo Bolsos'];

interface DemoVariant {
  sku: string;
  size?: string;
  color?: string;
}

interface DemoProduct {
  sku: string;
  name: string;
  type: 'SIMPLE' | 'VARIABLE';
  category: string;
  brand?: string;
  price: number;
  cost?: number;
  variants: DemoVariant[];
}

const COLORS: Record<string, string> = { Negro: 'NEG', Café: 'CAF', Blanco: 'BLA', Rojo: 'ROJ' };

const sizes = (sku: string, from: number, to: number, colors: string[]): DemoVariant[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i)).flatMap((size) =>
    colors.map((color) => ({ sku: `${sku}-${size}-${COLORS[color]}`, size, color })),
  );

const PRODUCTS: DemoProduct[] = [
  {
    sku: 'ZAP0101',
    name: 'Zapato de piel dama',
    type: 'VARIABLE',
    category: 'Calzado',
    brand: 'Demo Calzado',
    price: 89900,
    cost: 45000,
    variants: sizes('ZAP0101', 23, 26, ['Negro', 'Café']),
  },
  {
    sku: 'ZAP0102',
    name: 'Tenis urbano',
    type: 'VARIABLE',
    category: 'Calzado',
    brand: 'Demo Calzado',
    price: 129900,
    variants: sizes('ZAP0102', 25, 27, ['Blanco']),
  },
  {
    sku: 'BOL0201',
    name: 'Bolso tote',
    type: 'VARIABLE',
    category: 'Bolsos',
    brand: 'Demo Bolsos',
    price: 74900,
    variants: ['Negro', 'Rojo'].map((color) => ({ sku: `BOL0201-${COLORS[color]}`, color })),
  },
  {
    sku: 'ACC0301',
    name: 'Cinturón de piel',
    type: 'SIMPLE',
    category: 'Accesorios',
    price: 34900,
    // Variante por defecto con atributos nulos.
    variants: [{ sku: 'ACC0301' }],
  },
];

async function seedStructure(tx: Tx, summary: SeedSummary, warehouseId: string): Promise<void> {
  for (const zoneData of ZONES) {
    let zone = await tx.zone.findUnique({
      where: { warehouseId_code: { warehouseId, code: zoneData.code } },
    });
    if (!zone) {
      zone = await tx.zone.create({ data: { warehouseId, ...zoneData } });
      summary.created.push(`Zona ${zoneData.code}`);
    }
    for (const containerCode of CONTAINERS) {
      let container = await tx.container.findUnique({
        where: { zoneId_code: { zoneId: zone.id, code: containerCode } },
      });
      if (!container) {
        container = await tx.container.create({ data: { zoneId: zone.id, code: containerCode } });
        summary.created.push(`Contenedor ${zoneData.code}-${containerCode}`);
      }
      for (const rackCode of RACKS) {
        const exists = await tx.rack.findUnique({
          where: { containerId_code: { containerId: container.id, code: rackCode } },
        });
        if (exists) continue;
        const locationCode = buildLocationCode({
          zone: zoneData.code,
          container: containerCode,
          rack: rackCode,
        });
        await tx.rack.create({
          data: {
            containerId: container.id,
            warehouseId,
            code: rackCode,
            locationCode,
            capacityUnits: RACK_CAPACITY,
          },
        });
        summary.created.push(`Rack ${locationCode}`);
      }
    }
  }
}

async function seedCatalog(tx: Tx, summary: SeedSummary): Promise<void> {
  const brandIds = new Map<string, string>();
  for (const name of BRANDS) {
    let brand = await tx.brand.findUnique({ where: { name } });
    if (!brand) {
      brand = await tx.brand.create({ data: { name } });
      summary.created.push(`Marca ${name}`);
    }
    brandIds.set(name, brand.id);
  }

  for (const { variants, category, brand, ...product } of PRODUCTS) {
    let existing = await tx.product.findUnique({ where: { sku: product.sku } });
    if (!existing) {
      const categoryRow = await tx.category.findFirst({
        where: { parentId: null, name: category },
      });
      existing = await tx.product.create({
        data: {
          ...product,
          categoryId: categoryRow?.id ?? null,
          brandId: brand ? brandIds.get(brand)! : null,
        },
      });
      summary.created.push(`Producto ${product.sku}`);
    }
    for (const variant of variants) {
      if (await tx.productVariant.findUnique({ where: { sku: variant.sku } })) continue;
      await tx.productVariant.create({ data: { productId: existing.id, ...variant } });
      summary.created.push(`Variante ${variant.sku}`);
    }
  }
}

export const DEMO_NOTE = 'Demo';

/** Stock de ejemplo (spec F7 §7): `ZAP0101-26-NEG` agotado en S1 y disponible en S2. */
const STOCK: { branch: string; location: string; items: [sku: string, quantity: number][] }[] = [
  {
    branch: 'S1',
    location: 'A-01-01',
    items: [
      ['ZAP0101-23-NEG', 3],
      ['ZAP0101-24-NEG', 3],
      ['ZAP0101-25-NEG', 4],
    ],
  },
  {
    branch: 'S1',
    location: 'A-01-02',
    items: [
      ['ZAP0101-25-CAF', 1],
      ['ZAP0101-26-CAF', 2],
    ],
  },
  {
    branch: 'S1',
    location: 'B-01-01',
    items: [
      ['BOL0201-NEG', 5],
      ['BOL0201-ROJ', 2],
    ],
  },
  { branch: 'S1', location: 'C-01-01', items: [['ACC0301', 10]] },
  { branch: 'S1', location: 'STG-01-01', items: [['ZAP0102-26-BLA', 2]] },
  {
    branch: 'S2',
    location: 'STG-01-01',
    items: [
      ['ZAP0101-26-NEG', 2],
      ['ZAP0102-25-BLA', 1],
    ],
  },
];

/**
 * Carga el stock de ejemplo con `InventoryService` (`INITIAL_LOAD`, nota "Demo", a nombre del
 * owner). Solo corre si todavía no hay ningún movimiento con esa nota.
 */
async function seedStock(tx: Tx, summary: SeedSummary): Promise<void> {
  if (await tx.inventoryMovement.findFirst({ where: { note: DEMO_NOTE } })) return;
  const owner = await tx.user.findUniqueOrThrow({ where: { username: 'owner' } });
  const inventory = new InventoryService();
  for (const { branch, location, items } of STOCK) {
    const rack = await tx.rack.findFirstOrThrow({
      where: { locationCode: location, warehouse: { code: 'ALM1', branch: { code: branch } } },
    });
    for (const [sku, quantity] of items) {
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { sku } });
      await inventory.receive(tx, {
        type: 'INITIAL_LOAD',
        variantId: variant.id,
        rackId: rack.id,
        quantity,
        userId: owner.id,
        note: DEMO_NOTE,
      });
      summary.created.push(`Stock ${sku} × ${quantity} en ${branch} ${location}`);
    }
  }
}

/**
 * Seed de demo idempotente (spec F1 §7.3 y F7 §7): estructura del almacén ALM1 de S1,
 * catálogo de ejemplo y stock. Requiere el seed base; no modifica lo que ya existe.
 */
export async function seedDemo(prisma: PrismaClient): Promise<SeedSummary> {
  const summary = emptySummary();
  await prisma.$transaction(
    async (tx) => {
      const branch = await tx.branch.findUnique({ where: { code: 'S1' } });
      const warehouse =
        branch &&
        (await tx.warehouse.findUnique({
          where: { branchId_code: { branchId: branch.id, code: 'ALM1' } },
        }));
      if (!warehouse) {
        throw new Error(BASE_SEED_MISSING);
      }
      await seedStructure(tx, summary, warehouse.id);
      await seedCatalog(tx, summary);
      await seedStock(tx, summary);
    },
    { timeout: 60_000 },
  );
  return summary;
}
