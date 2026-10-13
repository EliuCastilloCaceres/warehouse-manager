import {
  emptyImportCells,
  type ImportColumn,
  type ImportRow,
  interpretImportRows,
  validateImportRows,
} from './index.js';

let next = 2;
function row(cells: Partial<Record<ImportColumn, string>>, rowNumber = next++): ImportRow {
  return { rowNumber, cells: { ...emptyImportCells(), ...cells } };
}

/** Producto simple nuevo y válido, para cambiarle una celda. */
const simple = (cells: Partial<Record<ImportColumn, string>> = {}) =>
  row({ sku_padre: 'ACC0301', nombre: 'Cinturón', tipo: 'simple', precio: '349', ...cells }, 2);

const issuesFor = (rows: ImportRow[]) =>
  validateImportRows(rows).map(({ rowNumber, field }) => `${rowNumber}:${field}`);

describe('reglas de celda (T4)', () => {
  it.each([
    ['tipo', 'Variable', true],
    ['tipo', 'otro', false],
    ['precio', '$1,299.50', true],
    ['precio', 'abc', false],
    ['existencia', '0', true],
    ['existencia', '-1', false],
    ['existencia', '1.5', false],
    ['activo', 'Sí', true],
    ['activo', 'no', true],
    ['activo', '1', true],
    ['activo', 'quizá', false],
    ['costo', '-', true],
    ['sku_padre', '-', false],
  ] as const)('%s = %j → válido: %s', (column, value, valid) => {
    // "Variable" pide además un sku_variante con atributo.
    const extra =
      column === 'tipo' && value === 'Variable'
        ? { sku_variante: 'ACC0301-NEG', color: 'Negro' }
        : {};
    const issues = validateImportRows([simple({ [column]: value, ...extra })]);
    if (valid) {
      expect(issues).toEqual([]);
    } else {
      expect(issues).toEqual([expect.objectContaining({ rowNumber: 2, field: column })]);
    }
  });

  it.each([
    ['a-1-3', true],
    ['ZZZ', false],
  ])('ubicación %j con existencia → válida: %s', (location, valid) => {
    const issues = validateImportRows([simple({ existencia: '5', ubicación: location })]);
    expect(issues).toEqual(
      valid ? [] : [expect.objectContaining({ rowNumber: 2, field: 'ubicación' })],
    );
  });

  it('sin existencia, la ubicación se ignora', () => {
    expect(validateImportRows([simple({ ubicación: 'ZZZ' })])).toEqual([]);
  });

  it('interpreta valores: centavos, ubicación canónica, existencia y borrado', () => {
    const { groups } = interpretImportRows([
      simple({
        precio: '$1,299.50',
        costo: '-',
        existencia: '7',
        ubicación: 'a-1-3',
        activo: 'NO',
      }),
    ]);
    expect(groups[0]).toMatchObject({
      parentSku: 'ACC0301',
      product: { name: 'Cinturón', type: 'SIMPLE', price: 129950, cost: null, isActive: false },
      lines: [{ rowNumber: 2, sku: null, stock: 7, location: 'A-01-03' }],
    });
  });

  it('al crear exige nombre, tipo y precio', () => {
    expect(issuesFor([row({ sku_padre: 'NUEVO01', nombre: 'Algo' }, 2)])).toEqual([
      '2:tipo',
      '2:precio',
    ]);
  });
});

describe('reglas entre filas (T5)', () => {
  const variant = (rowNumber: number, cells: Partial<Record<ImportColumn, string>>) =>
    row({ sku_padre: 'ZAP0101', ...cells }, rowNumber);
  const head = { nombre: 'Zapato', tipo: 'variable', precio: '899' };

  it('nombre distinto en dos filas del mismo sku_padre → error en la segunda', () => {
    expect(
      issuesFor([
        variant(2, { ...head, sku_variante: 'ZAP0101-25', talla: '25' }),
        variant(3, { nombre: 'Otro', sku_variante: 'ZAP0101-26', talla: '26' }),
      ]),
    ).toEqual(['3:nombre']);
  });

  it('sku_variante repetido → error', () => {
    expect(
      issuesFor([
        variant(2, { ...head, sku_variante: 'ZAP0101-25', talla: '25' }),
        variant(3, { sku_variante: 'zap0101-25', talla: '26' }),
      ]),
    ).toEqual(['3:sku_variante']);
  });

  it('un simple con 2 filas → error', () => {
    expect(issuesFor([simple(), row({ sku_padre: 'ACC0301' }, 3)])).toEqual(['3:sku_padre']);
  });

  it('una fila variable sin sku_variante → error', () => {
    expect(issuesFor([variant(2, { ...head, talla: '25' })])).toEqual(['2:sku_variante']);
  });

  it('el sku_variante no puede ser el SKU padre de otro producto del archivo', () => {
    expect(
      issuesFor([simple(), variant(3, { ...head, sku_variante: 'ACC0301', talla: '25' })]),
    ).toEqual(['3:sku_variante']);
  });

  it('un producto sin nombre, tipo ni precio se trata como existente (no los exige)', () => {
    expect(issuesFor([variant(2, { sku_variante: 'ZAP0101-25', precio_variante: '950' })])).toEqual(
      [],
    );
  });
});

describe('rendimiento (T6)', () => {
  it('valida 500 filas (100 productos × 5 variantes) en menos de 3 s', () => {
    const rows: ImportRow[] = [];
    for (let p = 0; p < 100; p++) {
      const parent = `PRD${String(p).padStart(4, '0')}`;
      for (let v = 0; v < 5; v++) {
        rows.push(
          row(
            {
              sku_padre: parent,
              ...(v === 0
                ? {
                    nombre: `Producto ${p}`,
                    tipo: 'variable',
                    precio: '899.00',
                    categoría: 'Calzado > Dama',
                  }
                : {}),
              sku_variante: `${parent}-${22 + v}`,
              talla: String(22 + v),
              color: 'Negro',
              existencia: '3',
              ubicación: 'A-01-01',
            },
            rows.length + 2,
          ),
        );
      }
    }
    const start = performance.now();
    const issues = validateImportRows(rows);
    const elapsed = performance.now() - start;
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(500);
    expect(elapsed).toBeLessThan(3000);
  });
});
