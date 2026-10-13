import {
  emptyImportCells,
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportRow,
  type ImportSummary,
  ImportValidationDto,
} from '@warehouse-manager/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { seedDemo } from '../../prisma/seed/demo.js';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { multipartFile } from './helpers/multipart.js';
import { receiveStock } from './helpers/products.js';
import { resetWithSeed } from './helpers/seed.js';

type Cells = Partial<Record<ImportColumn, string>>;

const rows = (...list: Cells[]): ImportRow[] =>
  list.map((cells, i) => ({ rowNumber: i + 2, cells: { ...emptyImportCells(), ...cells } }));

async function xlsx(headers: readonly string[], data: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Productos');
  sheet.addRow([...headers]);
  for (const row of data) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('carga masiva (T18–T25)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let token: string;
  let adminId: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await seedDemo(prisma);
    app = await createTestApp(prisma);
    const admin = await loginSeeded(app, prisma, 'admin');
    token = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (path: string, payload: object, authToken = token) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/products/import/${path}`,
      headers: bearer(authToken),
      payload: payload as Record<string, unknown>,
    });
  const counts = async () => ({
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    categories: await prisma.category.count(),
    brands: await prisma.brand.count(),
    stock: await prisma.stockLocation.count(),
    movements: await prisma.inventoryMovement.count(),
  });

  describe('plantilla (T18)', () => {
    it('tiene las hojas Productos, Instrucciones, Categorías y Marcas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products/import/template',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      expect(workbook.worksheets.map((s) => s.name)).toEqual([
        'Productos',
        'Instrucciones',
        'Categorías',
        'Marcas',
      ]);
      const products = workbook.getWorksheet('Productos')!;
      expect((products.getRow(1).values as unknown[]).slice(1)).toEqual([...IMPORT_COLUMNS]);
      // Sin filas de datos (las listas desplegables no cuentan como filas con valores).
      expect(products.actualRowCount).toBe(1);
      const categories = workbook.getWorksheet('Categorías')!;
      const paths = categories.getColumn(1).values.slice(2);
      expect(paths).toContain('Calzado');
      const brands = workbook.getWorksheet('Marcas')!.getColumn(1).values.slice(2);
      expect(brands).toContain('Demo Calzado');
    });

    it('sin products.import → 403', async () => {
      const seller = await createAndLogin(app, prisma, { username: 'vende' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products/import/template',
        headers: bearer(seller.accessToken),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('parse (T19)', () => {
    const parse = (
      buffer: Buffer,
      filename = 'carga.xlsx',
      contentType = 'application/octet-stream',
    ) => {
      const form = multipartFile(buffer, { filename, contentType });
      return app.inject({
        method: 'POST',
        url: '/api/v1/products/import/parse',
        headers: { ...bearer(token), ...form.headers },
        payload: form.payload,
      });
    };
    const line = (sku: string, price: number) => {
      const values = IMPORT_COLUMNS.map(() => '' as string | number);
      values[0] = sku;
      values[1] = `Producto ${sku}`;
      values[4] = 'simple';
      values[5] = price;
      return values;
    };

    it('lee las filas como texto, con su número de fila', async () => {
      const res = await parse(
        await xlsx(IMPORT_COLUMNS, [
          line('PAR0001', 899),
          line('PAR0002', 1299.5),
          line('PAR0003', 349),
        ]),
      );
      expect(res.statusCode).toBe(200);
      const parsed = res.json() as { rows: ImportRow[] };
      expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
      expect(parsed.rows[0]!.cells).toMatchObject({
        sku_padre: 'PAR0001',
        precio: '899',
        tipo: 'simple',
      });
      expect(parsed.rows[1]!.cells.precio).toBe('1299.5');
      expect(Object.keys(parsed.rows[0]!.cells)).toHaveLength(15);
    });

    it('encabezados alterados o más de 2 000 filas → 400 IMPORT_INVALID', async () => {
      const altered: string[] = [...IMPORT_COLUMNS];
      altered[1] = 'descripción';
      const bad = await parse(await xlsx(altered, [line('PAR0004', 1)]));
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe('IMPORT_INVALID');

      const many = await parse(
        await xlsx(
          IMPORT_COLUMNS,
          Array.from({ length: 2001 }, (_, i) => line(`MANY${String(i).padStart(4, '0')}`, 1)),
        ),
      );
      expect(many.statusCode).toBe(400);
      expect(many.json().code).toBe('IMPORT_INVALID');
    });

    it('un .csv → 415; más de 5 MiB → 413', async () => {
      const csv = await parse(Buffer.from('sku_padre,nombre\nA,B'), 'carga.csv', 'text/csv');
      expect(csv.statusCode).toBe(415);
      const big = await parse(Buffer.alloc(5 * 1024 * 1024 + 10, 1));
      expect(big.statusCode).toBe(413);
    });
  });

  describe('validate (T20)', () => {
    it('reporta errores contra la BD y el resumen sin escribir nada', async () => {
      // ZAP0101 (seed de demo) es variable y con historial.
      const zap = await prisma.productVariant.findUniqueOrThrow({
        where: { sku: 'ZAP0101-25-NEG' },
      });
      await receiveStock(prisma, zap.id, { userId: adminId, quantity: 1 });
      const before = await counts();
      const res = await post('validate', {
        rows: rows(
          {
            sku_padre: 'NUE0101',
            nombre: 'Sandalia',
            categoría: 'Calzado > Dama',
            marca: 'Marca Nueva',
            tipo: 'variable',
            precio: '599',
            sku_variante: 'BOL0201',
            talla: '24',
          },
          {
            sku_padre: 'NUE0101',
            sku_variante: 'NUE0101-25',
            talla: '25',
            existencia: '2',
            ubicación: 'Z-09-09',
          },
          { sku_padre: 'ZAP0101', tipo: 'simple' },
          { sku_padre: 'ACC0301', precio_variante: '300' },
        ),
      });
      expect(res.statusCode).toBe(200);
      const result = ImportValidationDto.parse(res.json());
      expect(result.issues.map((i) => `${i.rowNumber}:${i.field}`)).toEqual([
        '2:sku_variante',
        '3:ubicación',
        '4:tipo',
      ]);
      expect(result.issues[0]!.message).toBe('Ese SKU ya está en uso.');
      expect(result.summary).toMatchObject({
        productsToCreate: 1,
        productsToUpdate: 2,
        variantsToCreate: 2,
        categoriesToCreate: ['Calzado > Dama'],
        brandsToCreate: ['Marca Nueva'],
      });
      expect(await counts()).toEqual(before);
    });
  });

  describe('commit (T21)', () => {
    it('crea productos, categorías, marcas y existencia con INITIAL_LOAD', async () => {
      const res = await post('commit', {
        rows: rows(
          {
            sku_padre: 'IMP0101',
            nombre: 'Cartera',
            categoría: 'Bolsos > Carteras',
            marca: 'Marca Importada',
            tipo: 'simple',
            precio: '$1,299.50',
            existencia: '4',
          },
          {
            sku_padre: 'IMP0201',
            nombre: 'Bota',
            categoría: 'Calzado',
            tipo: 'variable',
            precio: '1599',
            costo: '800',
            sku_variante: 'IMP0201-24',
            talla: '24',
            existencia: '3',
            ubicación: 'a-1-1',
          },
          {
            sku_padre: 'IMP0201',
            sku_variante: 'IMP0201-25',
            talla: '25',
            precio_variante: '1699',
          },
          { sku_padre: 'IMP0201', sku_variante: 'IMP0201-26', talla: '26', existencia: '2' },
        ),
      });
      expect(res.statusCode).toBe(200);
      const summary = res.json() as ImportSummary;
      expect(summary).toMatchObject({
        productsToCreate: 2,
        variantsToCreate: 4,
        categoriesToCreate: ['Bolsos > Carteras'],
        brandsToCreate: ['Marca Importada'],
        stock: {
          units: 9,
          rows: 3,
          unitsToStaging: 6,
          addingToExisting: { units: 0, variants: 0 },
        },
      });

      const cartera = await prisma.product.findUniqueOrThrow({
        where: { sku: 'IMP0101' },
        include: { variants: true, category: true, brand: true },
      });
      expect(cartera).toMatchObject({
        price: 129950,
        type: 'SIMPLE',
        isActive: true,
        brand: { name: 'Marca Importada' },
      });
      expect(cartera.variants).toEqual([expect.objectContaining({ sku: 'IMP0101', size: null })]);
      const bota = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'IMP0201-25' } });
      expect(bota.priceOverride).toBe(169900);

      const stock = await prisma.stockLocation.findMany({
        where: { variant: { product: { sku: { in: ['IMP0101', 'IMP0201'] } } } },
        include: { rack: true, variant: true },
      });
      expect(stock.map((s) => [s.variant.sku, s.rack.locationCode, s.quantity]).sort()).toEqual([
        ['IMP0101', 'STG-01-01', 4],
        ['IMP0201-24', 'A-01-01', 3],
        ['IMP0201-26', 'STG-01-01', 2],
      ]);
      const movements = await prisma.inventoryMovement.findMany({
        where: { variant: { product: { sku: { in: ['IMP0101', 'IMP0201'] } } } },
      });
      expect(movements).toHaveLength(3);
      for (const m of movements)
        expect(m).toMatchObject({ type: 'INITIAL_LOAD', note: 'Carga masiva' });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'product.import' } });
      expect(log).toMatchObject({ userId: adminId, entity: 'Product', payload: summary });
    });
  });

  describe('actualizar (T22)', () => {
    it('solo cambia las celdas con valor; "-" borra un opcional', async () => {
      const before = await prisma.product.findUniqueOrThrow({
        where: { sku: 'IMP0201' },
        include: { variants: { orderBy: { sku: 'asc' } } },
      });
      const res = await post('commit', {
        rows: rows({
          sku_padre: 'IMP0201',
          costo: '-',
          sku_variante: 'IMP0201-24',
          precio_variante: '1650',
        }),
      });
      expect(res.statusCode).toBe(200);
      const after = await prisma.product.findUniqueOrThrow({
        where: { sku: 'IMP0201' },
        include: { variants: { orderBy: { sku: 'asc' } } },
      });
      expect(after).toMatchObject({ name: before.name, price: before.price, cost: null });
      expect(after.variants[0]).toMatchObject({
        sku: 'IMP0201-24',
        priceOverride: 165000,
        size: '24',
      });
      expect(after.variants[1]).toEqual(before.variants[1]);
    });

    it('"-" en nombre → IMPORT_INVALID', async () => {
      const res = await post('commit', {
        rows: rows({ sku_padre: 'IMP0201', nombre: '-', sku_variante: 'IMP0201-24' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'IMPORT_INVALID',
        details: [expect.objectContaining({ rowNumber: 2, field: 'nombre' })],
      });
    });
  });

  describe('existencia sobre stock previo (T23)', () => {
    it('pide confirmación y luego suma con PUTAWAY', async () => {
      const payload = {
        rows: rows({
          sku_padre: 'IMP0201',
          sku_variante: 'IMP0201-24',
          existencia: '5',
          ubicación: 'A-01-01',
        }),
      };
      const before = await counts();
      const first = await post('commit', payload);
      expect(first.statusCode).toBe(409);
      expect(first.json()).toMatchObject({
        code: 'IMPORT_CONFIRMATION_REQUIRED',
        details: { stock: { addingToExisting: { units: 5, variants: 1 } } },
      });
      expect(await counts()).toEqual(before);

      const ok = await post('commit', { ...payload, confirmStockAddition: true });
      expect(ok.statusCode).toBe(200);
      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { sku: 'IMP0201-24' },
      });
      const location = await prisma.stockLocation.findFirstOrThrow({
        where: { variantId: variant.id, rack: { locationCode: 'A-01-01' } },
      });
      expect(location.quantity).toBe(8);
      const last = await prisma.inventoryMovement.findFirstOrThrow({
        where: { variantId: variant.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(last).toMatchObject({ type: 'PUTAWAY', quantity: 5, note: 'Carga masiva' });
    });
  });

  describe('todo o nada (T24)', () => {
    it('una fila que choca con un SKU existente → nada se escribe', async () => {
      const list: Cells[] = Array.from({ length: 10 }, (_, i) => ({
        sku_padre: `TON${String(i).padStart(4, '0')}`,
        nombre: `Producto ${i}`,
        categoría: 'Nueva > Categoría',
        marca: 'Marca Atómica',
        tipo: 'simple',
        precio: '100',
        existencia: '1',
      }));
      // Fila 10 del Excel (la 9.ª de datos): su SKU ya es una variante de otro producto.
      list[8] = { ...list[8], sku_padre: 'ZAP0101-25-NEG' };
      const before = await counts();
      const res = await post('commit', { rows: rows(...list) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'IMPORT_INVALID',
        details: [{ rowNumber: 10, field: 'sku_padre', message: 'Ese SKU ya está en uso.' }],
      });
      expect(await counts()).toEqual(before);
    });
  });

  describe('permisos y capacidad (T25)', () => {
    it('sin inventory.putaway, solo las filas con existencia dan error', async () => {
      const importer = await createAndLogin(app, prisma, {
        username: 'importa',
        extraPermissions: ['products.import'],
      });
      const res = await post(
        'validate',
        {
          rows: rows(
            { sku_padre: 'PER0001', nombre: 'A', tipo: 'simple', precio: '1', existencia: '2' },
            { sku_padre: 'PER0002', nombre: 'B', tipo: 'simple', precio: '1' },
          ),
        },
        importer.accessToken,
      );
      expect(ImportValidationDto.parse(res.json()).issues).toEqual([
        expect.objectContaining({ rowNumber: 2, field: 'existencia' }),
      ]);
    });

    it('exceder la capacidad exige permiso y casilla', async () => {
      // A-01-02 (seed de demo, capacidad 40) con 38 ocupadas.
      const filler = await prisma.productVariant.findUniqueOrThrow({
        where: { sku: 'ZAP0101-26-NEG' },
      });
      await receiveStock(prisma, filler.id, { userId: adminId, quantity: 38, location: 'A-01-02' });
      const payload = (allowCapacityOverride: boolean) => ({
        allowCapacityOverride,
        rows: rows({
          sku_padre: 'CAP0001',
          nombre: 'Cap',
          tipo: 'simple',
          precio: '1',
          existencia: '5',
          ubicación: 'A-01-02',
        }),
      });
      const fields = async (res: Awaited<ReturnType<typeof post>>) =>
        ImportValidationDto.parse(res.json()).issues.map((i) => i.field);

      expect(await fields(await post('validate', payload(false)))).toEqual(['ubicación']);

      const noOverride = await createAndLogin(app, prisma, {
        username: 'sinexceder',
        extraPermissions: ['products.import', 'inventory.putaway'],
      });
      expect(await fields(await post('validate', payload(true), noOverride.accessToken))).toEqual([
        'ubicación',
      ]);

      const ok = await post('commit', payload(true));
      expect(ok.statusCode).toBe(200);
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'CAP0001' } });
      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { variantId: variant.id },
      });
      expect(movement.capacityOverridden).toBe(true);
    });
  });
});
