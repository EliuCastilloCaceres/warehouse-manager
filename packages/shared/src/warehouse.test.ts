import {
  colorName,
  ContainerBatchInput,
  ContainerCreateInput,
  ContainerUpdateInput,
  LOCATION_COLORS,
  LocationLabelsQuery,
  occupancyLevel,
  RackBatchInput,
  RackCreateInput,
  RackUpdateInput,
  variantStockStatus,
  WarehouseTreeQuery,
  ZoneCreateInput,
  ZoneUpdateInput,
} from './index.js';

describe('occupancyLevel (T1)', () => {
  it.each([
    [0, 40, 'green'],
    [27, 40, 'green'],
    [28, 40, 'amber'],
    [36, 40, 'amber'],
    [37, 40, 'red'],
    [45, 40, 'red'],
    [0, 0, 'none'],
    [5, 0, 'none'],
  ] as const)('%i/%i → %s', (occupied, capacity, level) => {
    expect(occupancyLevel(occupied, capacity)).toBe(level);
  });
});

describe('variantStockStatus (T2)', () => {
  it.each([
    [{ quantity: 0, reservedQty: 0, stagingQuantity: 0 }, 'AGOTADO', false, false],
    [{ quantity: 2, reservedQty: 0, stagingQuantity: 0 }, 'BAJO', false, false],
    [{ quantity: 3, reservedQty: 3, stagingQuantity: 0 }, 'BAJO', true, false],
    [{ quantity: 5, reservedQty: 0, stagingQuantity: 0 }, 'DISPONIBLE', false, false],
    [{ quantity: 6, reservedQty: 1, stagingQuantity: 2 }, 'DISPONIBLE', true, true],
    [{ quantity: 1, reservedQty: 0, stagingQuantity: 1 }, 'BAJO', false, true],
  ] as const)('%o con umbral 2 → %s', (stock, status, enPiso, enStaging) => {
    expect(variantStockStatus(stock, 2)).toEqual({ status, enPiso, enStaging });
  });
});

describe('entradas de estructura (T3)', () => {
  const zone = (code?: string) => ZoneCreateInput.safeParse({ code, name: 'Calzado dama' });

  it.each(['A', 'AB', ' ab '])('zona %j es válida', (code) => {
    expect(zone(code).success).toBe(true);
  });

  it.each(['STG', 'stg', 'A1', 'ABC', ''])('zona %j → error', (code) => {
    expect(zone(code).success).toBe(false);
  });

  it('la zona aplica defaults y normaliza el código', () => {
    expect(ZoneCreateInput.parse({ code: 'ab', name: ' Bolsos ' })).toEqual({
      code: 'AB',
      name: 'Bolsos',
      color: null,
      priority: 0,
      sortOrder: 0,
    });
  });

  it('color fuera de la paleta → error', () => {
    expect(ZoneCreateInput.safeParse({ name: 'A', color: '#000000' }).success).toBe(false);
    expect(RackCreateInput.safeParse({ capacityUnits: 40, labelColor: '#123456' }).success).toBe(
      false,
    );
    expect(ZoneCreateInput.safeParse({ name: 'A', color: '#2563EB' }).success).toBe(true);
  });

  it('contenedor "1" → "01"; "100" y "0" → error', () => {
    expect(ContainerCreateInput.parse({ code: '1' })).toEqual({ code: '01', name: null });
    expect(ContainerCreateInput.safeParse({ code: '100' }).success).toBe(false);
    expect(ContainerCreateInput.safeParse({ code: '0' }).success).toBe(false);
    expect(ContainerCreateInput.parse({ name: '  ' })).toEqual({ name: null });
  });

  it('rack sin código usa el siguiente libre (código opcional) y exige capacidad', () => {
    expect(RackCreateInput.parse({ capacityUnits: 40 })).toEqual({
      capacityUnits: 40,
      labelColor: null,
    });
    expect(RackCreateInput.safeParse({}).success).toBe(false);
  });

  it('lote con racksPerContainer sin capacidad → error en capacityUnits', () => {
    const result = ContainerBatchInput.safeParse({ count: 3, racksPerContainer: 4 });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['capacityUnits']);
    expect(ContainerBatchInput.safeParse({ count: 3 }).success).toBe(true);
    expect(
      ContainerBatchInput.safeParse({ count: 3, racksPerContainer: 4, capacityUnits: 40 }).success,
    ).toBe(true);
    expect(ContainerBatchInput.safeParse({ count: 100 }).success).toBe(false);
    expect(RackBatchInput.safeParse({ count: 0, capacityUnits: 40 }).success).toBe(false);
    expect(RackBatchInput.parse({ count: 10, capacityUnits: 40 })).toEqual({
      count: 10,
      capacityUnits: 40,
      labelColor: null,
    });
  });

  it.each([
    ['ZoneUpdateInput', ZoneUpdateInput],
    ['ContainerUpdateInput', ContainerUpdateInput],
    ['RackUpdateInput', RackUpdateInput],
  ] as const)('%s sin campos o con claves desconocidas → error', (_, schema) => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ foo: 1 }).success).toBe(false);
  });

  it('los Update no aplican defaults a los campos omitidos', () => {
    expect(ZoneUpdateInput.parse({ name: 'Bolsos' })).toEqual({ name: 'Bolsos' });
    expect(ZoneUpdateInput.safeParse({ code: 'STG' }).success).toBe(false);
    expect(ContainerUpdateInput.parse({ code: '7' })).toEqual({ code: '07' });
    expect(RackUpdateInput.parse({ labelColor: null })).toEqual({ labelColor: null });
  });

  it('LOCATION_COLORS tiene 10 colores con hex y nombre únicos', () => {
    expect(LOCATION_COLORS).toHaveLength(10);
    expect(new Set(LOCATION_COLORS.map((c) => c.hex)).size).toBe(10);
    expect(new Set(LOCATION_COLORS.map((c) => c.name)).size).toBe(10);
  });

  it('colorName', () => {
    expect(colorName('#2563EB')).toBe('Azul');
    expect(colorName('#2563eb')).toBe('Azul');
    expect(colorName('#000000')).toBeNull();
    expect(colorName(null)).toBeNull();
  });
});

describe('consultas de almacén', () => {
  it('WarehouseTreeQuery convierte includeInactive y valida status', () => {
    expect(WarehouseTreeQuery.parse({ includeInactive: 'true', status: 'BAJO' })).toEqual({
      includeInactive: true,
      status: 'BAJO',
    });
    expect(WarehouseTreeQuery.safeParse({ status: 'OTRO' }).success).toBe(false);
  });

  it('LocationLabelsQuery separa ids por coma y los exige fuera de "warehouse"', () => {
    const id = '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c';
    expect(LocationLabelsQuery.parse({ scope: 'rack', ids: `${id},${id}` }).ids).toEqual([id, id]);
    expect(LocationLabelsQuery.parse({ scope: 'warehouse' })).toEqual({ scope: 'warehouse' });
    expect(LocationLabelsQuery.safeParse({ scope: 'zone' }).success).toBe(false);
    expect(LocationLabelsQuery.safeParse({ scope: 'rack', ids: 'x' }).success).toBe(false);
  });
});
