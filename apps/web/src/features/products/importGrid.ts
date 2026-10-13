import {
  emptyImportCells,
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportIssue,
  type ImportRow,
} from '@warehouse-manager/shared';

/** Fila del editor: un id estable para React y las 15 celdas en texto. */
export type GridRow = { id: number } & Record<ImportColumn, string>;

let nextId = 0;

export function emptyGridRow(): GridRow {
  return { id: ++nextId, ...emptyImportCells() };
}

export function gridRowFrom(cells: Partial<Record<ImportColumn, string>>): GridRow {
  return { ...emptyGridRow(), ...cells };
}

/** Copia de la fila `index` justo debajo de ella, sin `sku_variante` (debe ser único). */
export function duplicateRow(rows: readonly GridRow[], index: number): GridRow[] {
  const source = rows[index];
  if (!source) return [...rows];
  const copy: GridRow = { ...source, id: ++nextId, sku_variante: '' };
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}

/** Número de fila como en Excel (1 = encabezado): la posición en el editor + 2. */
export const rowNumberOf = (index: number) => index + 2;

const isEmpty = (row: GridRow) => IMPORT_COLUMNS.every((column) => !row[column].trim());

/** Filas no vacías, con su número de fila del editor (para ubicar los errores). */
export function toImportRows(rows: readonly GridRow[]): ImportRow[] {
  return rows.flatMap((row, index) =>
    isEmpty(row)
      ? []
      : [
          {
            rowNumber: rowNumberOf(index),
            cells: Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, row[c]])) as Record<
              ImportColumn,
              string
            >,
          },
        ],
  );
}

/** Errores por celda: `"fila:columna"` → mensaje (el primero de cada celda). */
export function issuesByCell(issues: readonly ImportIssue[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const issue of issues) {
    const key = `${issue.rowNumber}:${issue.field ?? ''}`;
    if (!map.has(key)) map.set(key, issue.message);
  }
  return map;
}

/**
 * Pega un TSV (lo que copia Excel) desde la celda activa: cada línea es una fila y cada
 * tabulador, la columna siguiente. Agrega las filas que falten y descarta lo que sobre a la
 * derecha de la última columna.
 */
export function pasteTsv(
  rows: readonly GridRow[],
  start: { rowIdx: number; column: ImportColumn },
  text: string,
): GridRow[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const firstColumn = IMPORT_COLUMNS.indexOf(start.column);
  const next = [...rows];
  lines.forEach((line, offset) => {
    const index = start.rowIdx + offset;
    while (next.length <= index) next.push(emptyGridRow());
    const row = { ...next[index]! };
    line.split('\t').forEach((value, i) => {
      const column = IMPORT_COLUMNS[firstColumn + i];
      if (column) row[column] = value.trim();
    });
    next[index] = row;
  });
  return next;
}
