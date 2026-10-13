import { z } from 'zod';
import { NonNegativeInt } from './common.js';
import type { ProductType } from './enums.js';
import { parseLocationCode } from './locationCode.js';
import { parseMoney } from './money.js';
import { CategoryPath } from './products.js';
import { SkuSchema } from './sku.js';

export const IMPORT_COLUMNS = [
  'sku_padre',
  'nombre',
  'categoría',
  'marca',
  'tipo',
  'precio',
  'costo',
  'sku_variante',
  'talla',
  'color',
  'material',
  'precio_variante',
  'existencia',
  'ubicación',
  'activo',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_STOCK = 100_000;
/** En una actualización, `-` borra un valor opcional. */
export const CLEAR_TOKEN = '-';

export const ImportRow = z.object({
  rowNumber: z.number().int().min(2), // fila del Excel (1 = encabezado)
  cells: z.record(z.enum(IMPORT_COLUMNS), z.string()), // texto crudo
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportIssue = z.object({
  rowNumber: z.number().int(),
  field: z.enum(IMPORT_COLUMNS).nullable(),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof ImportIssue>;

export const ImportValidateInput = z.object({
  rows: z.array(ImportRow).min(1).max(IMPORT_MAX_ROWS),
  allowCapacityOverride: z.boolean().default(false),
});
export type ImportValidateInput = z.infer<typeof ImportValidateInput>;

export const ImportCommitInput = ImportValidateInput.extend({
  confirmStockAddition: z.boolean().default(false),
});
export type ImportCommitInput = z.infer<typeof ImportCommitInput>;

export const ImportSummary = z.object({
  productsToCreate: NonNegativeInt,
  productsToUpdate: NonNegativeInt,
  variantsToCreate: NonNegativeInt,
  variantsToUpdate: NonNegativeInt,
  categoriesToCreate: z.array(z.string()),
  brandsToCreate: z.array(z.string()),
  stock: z.object({
    units: NonNegativeInt,
    rows: NonNegativeInt,
    unitsToStaging: NonNegativeInt,
    addingToExisting: z.object({ units: NonNegativeInt, variants: NonNegativeInt }),
  }),
});
export type ImportSummary = z.infer<typeof ImportSummary>;

export const ImportValidationDto = z.object({
  issues: z.array(ImportIssue),
  summary: ImportSummary,
});
export type ImportValidationDto = z.infer<typeof ImportValidationDto>;

export const ImportParseDto = z.object({ rows: z.array(ImportRow) });
export type ImportParseDto = z.infer<typeof ImportParseDto>;

/** Fila vacía (todas las columnas en `""`), para el editor y la lectura del `.xlsx`. */
export function emptyImportCells(): Record<ImportColumn, string> {
  return Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ''])) as Record<ImportColumn, string>;
}

// ---------------------------------------------------------------------------------------------
// Interpretación de filas (spec F6 §5.3). En cada valor: `undefined` = celda vacía (no cambia),
// `null` = `-` (borrar un opcional) y cualquier otro = el valor nuevo.

/** Columnas de producto: deben coincidir entre las filas de un mismo `sku_padre`. */
export interface ImportProductFields {
  name?: string;
  category?: string | null;
  brand?: string | null;
  type?: ProductType;
  price?: number;
  cost?: number | null;
  isActive?: boolean;
}

/** Una fila = una variante (en un `simple`, la variante por defecto). */
export interface ImportLine {
  rowNumber: number;
  /** `null` en un `simple` (usa el SKU padre) o si la celda está vacía o es inválida. */
  sku: string | null;
  /** La celda `sku_variante` venía vacía. */
  skuCellEmpty: boolean;
  size?: string | null;
  color?: string | null;
  material?: string | null;
  priceOverride?: number | null;
  /** 0 = sin existencia. */
  stock: number;
  /** Código canónico del rack; `null` = staging. */
  location: string | null;
}

export interface ImportGroup {
  parentSku: string;
  product: ImportProductFields;
  /** Fila de la que salió cada columna de producto (para ubicar errores). */
  productRows: Partial<Record<keyof ImportProductFields, number>>;
  /** Columnas de producto con alguna celda inválida (ya reportada). */
  invalidFields: Set<keyof ImportProductFields>;
  lines: ImportLine[];
}

const CLEARABLE = new Set<ImportColumn>([
  'costo',
  'categoría',
  'marca',
  'talla',
  'color',
  'material',
  'precio_variante',
]);

const PRODUCT_COLUMNS = {
  nombre: 'name',
  categoría: 'category',
  marca: 'brand',
  tipo: 'type',
  precio: 'price',
  costo: 'cost',
  activo: 'isActive',
} as const satisfies Partial<Record<ImportColumn, keyof ImportProductFields>>;

const COLUMN_OF = Object.fromEntries(
  Object.entries(PRODUCT_COLUMNS).map(([column, field]) => [field, column]),
) as Record<keyof ImportProductFields, ImportColumn>;

const TRUE = new Set(['si', 'sí', '1', 'true']);
const FALSE = new Set(['no', '0', 'false']);
const MONEY_MESSAGE = 'Escribe un importe en pesos, p. ej. 899.00';

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (message: string): Parsed<never> => ({ ok: false, message });

const maxLength = (max: number) => (raw: string) =>
  raw.length <= max ? ok(raw) : fail(`Máximo ${max} caracteres`);

const money = (raw: string) => {
  const cents = parseMoney(raw);
  return cents === null ? fail(MONEY_MESSAGE) : ok(cents);
};

const sku = (raw: string) => {
  const result = SkuSchema.safeParse(raw);
  return result.success ? ok(result.data) : fail(result.error.issues[0]!.message);
};

const PARSERS = {
  nombre: maxLength(200),
  categoría: (raw: string) => {
    const result = CategoryPath.safeParse(raw);
    return result.success ? ok(result.data) : fail(result.error.issues[0]!.message);
  },
  marca: maxLength(60),
  tipo: (raw: string) => {
    const value = raw.toLowerCase();
    if (value === 'simple') return ok<ProductType>('SIMPLE');
    if (value === 'variable') return ok<ProductType>('VARIABLE');
    return fail('El tipo debe ser simple o variable');
  },
  precio: money,
  costo: money,
  sku_variante: sku,
  talla: maxLength(40),
  color: maxLength(40),
  material: maxLength(40),
  precio_variante: money,
  existencia: (raw: string) => {
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return n >= 0 && n <= IMPORT_MAX_STOCK
      ? ok(n)
      : fail('La existencia debe ser un entero de 0 a 100 000');
  },
  ubicación: (raw: string) => {
    const location = parseLocationCode(raw);
    return location ? ok(location.code) : fail('Ubicación no válida (p. ej. A-01-03)');
  },
  activo: (raw: string) => {
    const value = raw.toLowerCase();
    if (TRUE.has(value)) return ok(true);
    if (FALSE.has(value)) return ok(false);
    return fail('Escribe sí o no');
  },
};

const INVALID = Symbol('invalid');
type CellResult<T> = T | null | undefined | typeof INVALID;

/**
 * Lee las filas: reglas de celda, columnas de producto que deben coincidir entre filas del mismo
 * `sku_padre`, `simple` de una sola fila y `sku_variante` obligatorio, distinto del padre y sin
 * repetir. No sabe qué existe en la BD: la obligatoriedad al crear la revisa `creationIssues`.
 */
export function interpretImportRows(rows: readonly ImportRow[]): {
  issues: ImportIssue[];
  groups: ImportGroup[];
} {
  const issues: ImportIssue[] = [];
  const groups = new Map<string, ImportGroup>();
  const variantSkus = new Map<string, number>();

  for (const row of rows) {
    const { rowNumber } = row;
    const issue = (field: ImportColumn | null, message: string) =>
      issues.push({ rowNumber, field, message });
    const read = <T>(column: ImportColumn, parse: (raw: string) => Parsed<T>): CellResult<T> => {
      const raw = (row.cells[column] ?? '').trim();
      if (raw === '') return undefined;
      if (raw === CLEAR_TOKEN) {
        if (CLEARABLE.has(column)) return null;
        issue(column, 'Este campo no se puede borrar con "-"');
        return INVALID;
      }
      const parsed = parse(raw);
      if (parsed.ok) return parsed.value;
      issue(column, parsed.message);
      return INVALID;
    };

    const parent = read('sku_padre', sku);
    if (parent === undefined) issue('sku_padre', 'El SKU padre es obligatorio');

    const product: Partial<Record<keyof ImportProductFields, unknown>> = {};
    for (const [column, field] of Object.entries(PRODUCT_COLUMNS) as [
      keyof typeof PRODUCT_COLUMNS,
      keyof ImportProductFields,
    ][]) {
      product[field] = read(column, PARSERS[column] as (raw: string) => Parsed<unknown>);
    }
    const variantSku = read('sku_variante', PARSERS.sku_variante);
    // Variables sueltas: en un objeto, el tipo del símbolo INVALID se ensancharía a `symbol`.
    const size = read('talla', PARSERS.talla);
    const color = read('color', PARSERS.color);
    const material = read('material', PARSERS.material);
    const priceOverride = read('precio_variante', PARSERS.precio_variante);
    const stock = read('existencia', PARSERS.existencia);
    const hasStock = typeof stock === 'number' && stock > 0;
    // Sin existencia, la ubicación se ignora.
    const location = hasStock ? read('ubicación', PARSERS.ubicación) : undefined;

    if (typeof variantSku === 'string') {
      const first = variantSkus.get(variantSku);
      if (first !== undefined) {
        issue('sku_variante', `Este SKU de variante ya aparece en la fila ${first}`);
      } else {
        variantSkus.set(variantSku, rowNumber);
      }
    }

    if (typeof parent !== 'string') continue;
    let group = groups.get(parent);
    if (!group) {
      group = {
        parentSku: parent,
        product: {},
        productRows: {},
        invalidFields: new Set(),
        lines: [],
      };
      groups.set(parent, group);
    }
    for (const [field, value] of Object.entries(product) as [
      keyof ImportProductFields,
      unknown,
    ][]) {
      if (value === INVALID) group.invalidFields.add(field);
      if (value === undefined || value === INVALID) continue;
      const firstRow = group.productRows[field];
      if (firstRow === undefined) {
        (group.product as Record<string, unknown>)[field] = value;
        group.productRows[field] = rowNumber;
      } else if (group.product[field] !== value) {
        issue(COLUMN_OF[field], `No coincide con la fila ${firstRow} del mismo SKU padre`);
      }
    }
    const value = <T>(cell: CellResult<T>) =>
      (cell === INVALID ? undefined : cell) as T | null | undefined;
    group.lines.push({
      rowNumber,
      sku: typeof variantSku === 'string' ? variantSku : null,
      skuCellEmpty: variantSku === undefined,
      size: value(size),
      color: value(color),
      material: value(material),
      priceOverride: value(priceOverride),
      stock: hasStock ? stock : 0,
      location: typeof location === 'string' ? location : null,
    });
  }

  for (const group of groups.values()) {
    for (const line of group.lines) {
      if (line.sku && line.sku !== group.parentSku && groups.has(line.sku)) {
        issues.push({
          rowNumber: line.rowNumber,
          field: 'sku_variante',
          message: 'Ese SKU es el SKU padre de otro producto del archivo',
        });
      }
    }
    issues.push(...typeIssues(group, group.product.type));
  }

  return { issues, groups: [...groups.values()] };
}

/**
 * Reglas que dependen del tipo: un `simple` ocupa una fila, sin atributos y con `sku_variante`
 * vacío o igual al padre; en un `variable`, `sku_variante` es obligatorio y distinto del padre.
 * Sin tipo conocido no revisa nada (el servidor lo vuelve a llamar con el tipo de la BD).
 */
export function typeIssues(group: ImportGroup, type: ProductType | undefined): ImportIssue[] {
  const issues: ImportIssue[] = [];
  group.lines.forEach((line, index) => {
    const issue = (field: ImportColumn, message: string) =>
      issues.push({ rowNumber: line.rowNumber, field, message });
    if (type === 'SIMPLE') {
      if (index > 0) issue('sku_padre', 'Un producto simple ocupa una sola fila');
      if (line.sku && line.sku !== group.parentSku) {
        issue('sku_variante', 'En un producto simple, déjalo vacío o repite el SKU padre');
      }
      if (line.size || line.color || line.material) {
        issue('talla', 'Un producto simple no lleva talla, color ni material');
      }
    } else if (type === 'VARIABLE') {
      if (line.skuCellEmpty) issue('sku_variante', 'Obligatorio en un producto variable');
      else if (line.sku === group.parentSku)
        issue('sku_variante', 'Debe ser distinto del SKU padre');
    }
  });
  return issues;
}

/** Errores de obligatoriedad de un producto que se va a crear (o de sus variantes nuevas). */
export function creationIssues(
  group: ImportGroup,
  isNewVariant: (line: ImportLine) => boolean = () => true,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const firstRow = group.lines[0]?.rowNumber ?? 0;
  const required: [keyof ImportProductFields, string][] = [
    ['name', 'El nombre es obligatorio al crear'],
    ['type', 'El tipo es obligatorio al crear'],
    ['price', 'El precio es obligatorio al crear'],
  ];
  for (const [field, message] of required) {
    if (group.invalidFields.has(field)) continue;
    if (group.product[field] === undefined || group.product[field] === null) {
      issues.push({ rowNumber: firstRow, field: COLUMN_OF[field], message });
    }
  }
  if (group.product.type === 'VARIABLE') issues.push(...newVariantIssues(group, isNewVariant));
  return issues;
}

/** Una variante nueva de un `variable` necesita talla, color o material. */
export function newVariantIssues(
  group: ImportGroup,
  isNewVariant: (line: ImportLine) => boolean,
): ImportIssue[] {
  return group.lines
    .filter((line) => isNewVariant(line) && !line.size && !line.color && !line.material)
    .map((line) => ({
      rowNumber: line.rowNumber,
      field: 'talla' as const,
      message: 'Una variante nueva necesita talla, color o material',
    }));
}

/**
 * En el navegador no se sabe qué existe: un producto se trata como nuevo si alguna de sus filas
 * trae nombre, tipo o precio (el servidor tiene la última palabra).
 */
export function looksNew(group: ImportGroup): boolean {
  return (
    group.productRows.name !== undefined ||
    group.productRows.type !== undefined ||
    group.productRows.price !== undefined
  );
}

/** Reglas de celda y entre filas (spec F6 §5.3), ordenadas por fila. Corre en navegador y API. */
export function validateImportRows(rows: readonly ImportRow[]): ImportIssue[] {
  const { issues, groups } = interpretImportRows(rows);
  for (const group of groups) {
    if (looksNew(group)) issues.push(...creationIssues(group));
  }
  return issues.sort((a, b) => a.rowNumber - b.rowNumber);
}
