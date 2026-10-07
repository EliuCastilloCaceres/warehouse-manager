import { buildLocationCode } from '@warehouse-manager/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
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

/**
 * Seed de demo idempotente (spec F1 §7.3): estructura del almacén ALM1 de S1 y catálogo
 * de ejemplo, sin stock. Requiere el seed base; no modifica lo que ya existe.
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
    },
    { timeout: 60_000 },
  );
  return summary;
}
