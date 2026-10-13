import {
  emptyImportCells,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  type ImportColumn,
  type ImportIssue,
  type ImportRow,
} from '@warehouse-manager/shared';
import ExcelJS from 'exceljs';
import { DomainError } from '../../core/errors.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PRODUCTS_SHEET = 'Productos';

const INSTRUCTIONS = [
  ['Carga masiva de productos'],
  [],
  ['Cada fila es una variante. Las filas con el mismo sku_padre forman un producto.'],
  [
    'Columnas de producto (nombre, categoría, marca, tipo, precio, costo, activo): si se repiten en varias filas, deben coincidir.',
  ],
  ['Un producto simple ocupa una sola fila; deja sku_variante vacío o repite el sku_padre.'],
  [
    'Un producto variable lleva sku_variante en cada fila y al menos talla, color o material en sus variantes nuevas.',
  ],
  [],
  ['Al crear: sku_padre, nombre, tipo (simple o variable) y precio son obligatorios.'],
  [
    'Al actualizar: una celda vacía no cambia el valor y "-" borra un opcional (costo, categoría, marca, talla, color, material, precio_variante).',
  ],
  [],
  ['precio, costo y precio_variante: en pesos, p. ej. 899.00 o $1,299.50.'],
  ['categoría: hasta 3 niveles separados por ">", p. ej. Calzado > Dama. Si no existe, se crea.'],
  ['marca: si no existe, se crea.'],
  ['existencia: unidades a SUMAR (0 o vacía = ninguna). Requiere permiso para ubicar productos.'],
  ['ubicación: código del rack (p. ej. A-01-03). Vacía = staging del almacén.'],
  ['activo: sí o no. Vacía = no cambia (al crear, sí).'],
  [],
  [
    'Ejemplo (variable): ZAP0101 | Zapato de piel dama | Calzado > Dama | Demo Calzado | variable | 899.00 | 450.00 | ZAP0101-25-NEG | 25 | Negro | | | 5 | A-01-03 | sí',
  ],
  [
    'Ejemplo (simple): ACC0301 | Cinturón de piel | Accesorios | | simple | 349.00 | | | | | | | 10 | | sí',
  ],
];

/** Plantilla `.xlsx`: Productos (encabezados), Instrucciones, Categorías y Marcas. */
export async function buildTemplate(catalogs: {
  categories: readonly string[];
  brands: readonly string[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const products = workbook.addWorksheet(PRODUCTS_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  products.columns = IMPORT_COLUMNS.map((column) => ({
    header: column,
    key: column,
    width: column === 'nombre' || column === 'categoría' ? 28 : 14,
  }));
  products.getRow(1).font = { bold: true };
  const lists: Partial<Record<ImportColumn, string>> = {
    tipo: '"simple,variable"',
    activo: '"sí,no"',
  };
  for (const [column, formula] of Object.entries(lists)) {
    const letter = products.getColumn(column).letter;
    for (let row = 2; row <= IMPORT_MAX_ROWS + 1; row++) {
      products.getCell(`${letter}${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
      };
    }
  }

  workbook.addWorksheet('Instrucciones').addRows(INSTRUCTIONS);
  const categories = workbook.addWorksheet('Categorías');
  categories.addRows([['categoría'], ...catalogs.categories.map((path) => [path])]);
  const brands = workbook.addWorksheet('Marcas');
  brands.addRows([['marca'], ...catalogs.brands.map((name) => [name])]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Encabezado comparable: sin acentos, en minúsculas y sin espacios en los extremos. */
const headerKey = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

const COLUMN_BY_HEADER = new Map(IMPORT_COLUMNS.map((column) => [headerKey(column), column]));

/** Valor de una celda como texto, sin formato (`899` → `"899"`). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text);
  return '';
}

const invalid = (message: string): DomainError =>
  new DomainError('IMPORT_INVALID', {
    details: [{ rowNumber: 1, field: null, message } satisfies ImportIssue],
  });

/**
 * Lee la hoja `Productos` (o la primera): los 15 encabezados de `IMPORT_COLUMNS` (sin importar
 * mayúsculas, acentos ni orden), celdas como texto y sin filas vacías (spec F6 §6).
 */
export async function parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw invalid('No se pudo leer el archivo; usa un .xlsx de Excel.');
  }
  const sheet = workbook.getWorksheet(PRODUCTS_SHEET) ?? workbook.worksheets[0];
  if (!sheet) throw invalid('El archivo no tiene hojas.');

  const columns = new Map<number, ImportColumn>();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = cellText(cell.value).trim();
    if (!header) return;
    const column = COLUMN_BY_HEADER.get(headerKey(header));
    if (!column || [...columns.values()].includes(column)) {
      throw invalid(`Encabezado no reconocido o repetido: "${header}".`);
    }
    columns.set(index, column);
  });
  const missing = IMPORT_COLUMNS.filter((column) => ![...columns.values()].includes(column));
  if (missing.length > 0) throw invalid(`Faltan columnas: ${missing.join(', ')}.`);

  const rows: ImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = emptyImportCells();
    for (const [index, column] of columns)
      cells[column] = cellText(row.getCell(index).value).trim();
    if (Object.values(cells).some(Boolean)) rows.push({ rowNumber, cells });
  });
  if (rows.length > IMPORT_MAX_ROWS) {
    throw invalid(`El archivo tiene ${rows.length} filas; el máximo es ${IMPORT_MAX_ROWS}.`);
  }
  return rows;
}
