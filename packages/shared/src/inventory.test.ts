import {
  ADJUSTMENT_REASON_LABELS,
  AdjustInput,
  AdjustmentReason,
  ContentQuery,
  LocateResultDto,
  LocationLabelDto,
  MovementListQuery,
  MovementRowDto,
  NodeContentDto,
  PutawayBatchInput,
  PutawayInput,
  RelocateInput,
  SuggestionsDto,
  SuggestQuery,
  WarehouseTreeDto,
} from './index.js';

const UUID = (n: number) => `9a8b7c6d-5e4f-4a3b-8c2d-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-14T15:00:00.000Z';
const stamps = { createdAt: NOW, updatedAt: NOW };

const pathsOf = (
  schema: { safeParse: (v: unknown) => { error?: { issues: { path: PropertyKey[] }[] } } },
  input: unknown,
) => schema.safeParse(input).error?.issues.map((i) => i.path.join('.')) ?? [];

describe('entradas de inventario (T4)', () => {
  const batchItem = (n: number) => ({ variantId: UUID(n), quantity: 1, source: 'NEW' });

  it('PutawayInput aplica overrideCapacity = false y valida el origen', () => {
    expect(
      PutawayInput.parse({ variantId: UUID(1), rackId: UUID(2), quantity: 2, source: 'STAGING' }),
    ).toMatchObject({ overrideCapacity: false });
    expect(
      PutawayInput.safeParse({ variantId: UUID(1), rackId: UUID(2), quantity: 2, source: 'X' })
        .success,
    ).toBe(false);
    expect(
      PutawayInput.safeParse({ variantId: UUID(1), rackId: UUID(2), quantity: 0, source: 'NEW' })
        .success,
    ).toBe(false);
  });

  it('PutawayBatchInput con variante repetida o 101 ítems → error', () => {
    expect(
      pathsOf(PutawayBatchInput, { rackId: UUID(9), items: [batchItem(1), batchItem(1)] }),
    ).toEqual(['items.1.variantId']);
    const many = Array.from({ length: 101 }, (_, i) => batchItem(i));
    expect(PutawayBatchInput.safeParse({ rackId: UUID(999), items: many }).success).toBe(false);
    expect(
      PutawayBatchInput.safeParse({ rackId: UUID(999), items: many.slice(0, 100) }).success,
    ).toBe(true);
    expect(PutawayBatchInput.safeParse({ rackId: UUID(9), items: [] }).success).toBe(false);
  });

  it('RelocateInput: items y all a la vez, ninguno o el mismo rack → error', () => {
    const base = { fromRackId: UUID(1), toRackId: UUID(2) };
    const items = [{ variantId: UUID(3), quantity: 1 }];
    expect(RelocateInput.safeParse({ ...base, items, all: true }).success).toBe(false);
    expect(RelocateInput.safeParse(base).success).toBe(false);
    expect(pathsOf(RelocateInput, { ...base, toRackId: UUID(1), all: true })).toEqual(['toRackId']);
    expect(RelocateInput.parse({ ...base, all: true })).toMatchObject({ overrideCapacity: false });
    expect(RelocateInput.safeParse({ ...base, items }).success).toBe(true);
    expect(RelocateInput.safeParse({ ...base, all: false }).success).toBe(false);
  });

  it('AdjustInput sin nota o con motivo inválido → error', () => {
    const base = {
      variantId: UUID(1),
      rackId: UUID(2),
      direction: 'OUT',
      quantity: 1,
      reason: 'DAMAGE',
      note: 'Tacón roto',
    };
    expect(AdjustInput.parse(base)).toMatchObject({ note: 'Tacón roto', overrideCapacity: false });
    expect(pathsOf(AdjustInput, { ...base, note: '   ' })).toEqual(['note']);
    expect(pathsOf(AdjustInput, { ...base, note: undefined })).toEqual(['note']);
    expect(pathsOf(AdjustInput, { ...base, reason: 'ROBO' })).toEqual(['reason']);
    expect(pathsOf(AdjustInput, { ...base, direction: 'SIDE' })).toEqual(['direction']);
    expect(pathsOf(AdjustInput, { ...base, note: 'x'.repeat(301) })).toEqual(['note']);
  });

  it('MovementListQuery: types separados por coma → arreglo; "to" antes de "from" → error', () => {
    expect(MovementListQuery.parse({ types: 'PUTAWAY,RELOCATE' }).types).toEqual([
      'PUTAWAY',
      'RELOCATE',
    ]);
    expect(MovementListQuery.parse({ types: ['SALE'] }).types).toEqual(['SALE']);
    expect(MovementListQuery.parse({}).types).toBeUndefined();
    expect(MovementListQuery.safeParse({ types: 'PUTAWAY,ROBO' }).success).toBe(false);
    expect(pathsOf(MovementListQuery, { from: '2026-10-02', to: '2026-10-01' })).toEqual(['to']);
    expect(MovementListQuery.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(
      true,
    );
    expect(MovementListQuery.safeParse({ from: '01/10/2026' }).success).toBe(false);
  });

  it('SuggestQuery y ContentQuery convierten la query string', () => {
    expect(SuggestQuery.parse({ variantId: UUID(1), quantity: '3' })).toEqual({
      variantId: UUID(1),
      quantity: 3,
    });
    expect(SuggestQuery.safeParse({ variantId: UUID(1), quantity: '0' }).success).toBe(false);
    expect(ContentQuery.parse({ status: 'EN_PISO' })).toMatchObject({ status: 'EN_PISO', page: 1 });
    expect(ContentQuery.safeParse({ status: 'DISPONIBLE' }).success).toBe(false);
  });
});

const occupancy = { capacity: 40, occupied: 10, reserved: 1, free: 30, pct: 25, level: 'green' };
const variantDetail = {
  id: UUID(2),
  productId: UUID(1),
  sku: 'ZAP0101-25-NEG',
  barcode: null,
  size: '25',
  color: 'Negro',
  material: null,
  priceOverride: null,
  isActive: true,
  ...stamps,
  effectivePrice: 89900,
  stock: { quantity: 6, reservedQty: 1, available: 5 },
  hasHistory: true,
  isEffectivelyActive: true,
  thumbUrl: null,
};
const listItem = {
  id: UUID(1),
  sku: 'ZAP0101',
  name: 'Zapato de piel dama',
  description: null,
  categoryId: null,
  brandId: null,
  type: 'VARIABLE',
  price: 89900,
  cost: null,
  tags: [],
  isActive: true,
  ...stamps,
  category: null,
  brand: null,
  thumbUrl: null,
  variantCount: 1,
  totalStock: 6,
};
const movement = {
  id: UUID(20),
  variantId: UUID(2),
  fromRackId: null,
  toRackId: UUID(10),
  quantity: 4,
  type: 'ADJUSTMENT_IN',
  userId: UUID(30),
  referenceType: null,
  referenceId: null,
  note: 'Conteo de octubre',
  adjustmentReason: 'PHYSICAL_COUNT',
  capacityOverridden: false,
  createdAt: NOW,
};

describe('motivos, fixtures y DTOs (T5)', () => {
  it('ADJUSTMENT_REASON_LABELS cubre los 6 motivos en español', () => {
    expect(Object.keys(ADJUSTMENT_REASON_LABELS).sort()).toEqual(
      [...AdjustmentReason.options].sort(),
    );
    expect(AdjustmentReason.options).toHaveLength(6);
    expect(ADJUSTMENT_REASON_LABELS.PHYSICAL_COUNT).toBe('Conteo físico');
    expect(ADJUSTMENT_REASON_LABELS.DAMAGE).toBe('Merma o daño');
  });

  it('WarehouseTreeDto', () => {
    const rack = {
      id: UUID(10),
      containerId: UUID(11),
      warehouseId: UUID(13),
      code: '01',
      locationCode: 'A-01-01',
      capacityUnits: 40,
      labelColor: null,
      isActive: true,
      ...stamps,
      occupancy,
      colorHex: '#2563EB',
      matchCount: 1,
    };
    const tree = {
      warehouse: {
        id: UUID(13),
        branchId: UUID(14),
        code: 'ALM1',
        name: 'Almacén principal',
        isActive: true,
        ...stamps,
      },
      totals: occupancy,
      staging: { rackId: UUID(15), locationCode: 'STG-01-01', occupied: 2, reserved: 0 },
      zones: [
        {
          id: UUID(12),
          warehouseId: UUID(13),
          code: 'A',
          name: 'Calzado dama',
          color: '#2563EB',
          isStaging: false,
          priority: 0,
          sortOrder: 0,
          isActive: true,
          ...stamps,
          occupancy,
          containers: [
            {
              id: UUID(11),
              zoneId: UUID(12),
              code: '01',
              name: null,
              isActive: true,
              ...stamps,
              occupancy,
              racks: [rack],
            },
          ],
        },
      ],
    };
    expect(WarehouseTreeDto.safeParse(tree).success).toBe(true);
    const overCapacity = { ...occupancy, occupied: 45, free: -5, pct: 112.5, level: 'red' };
    expect(WarehouseTreeDto.safeParse({ ...tree, totals: overCapacity }).success).toBe(true);
    expect(
      WarehouseTreeDto.safeParse({ ...tree, totals: { ...occupancy, level: 'blue' } }).success,
    ).toBe(false);
  });

  it('LocateResultDto con y sin otherBranches', () => {
    const locateVariant = {
      variant: variantDetail,
      totals: { quantity: 6, reservedQty: 1, available: 5 },
      stock: { status: 'DISPONIBLE', enPiso: true, enStaging: true },
      locations: [
        {
          rackId: UUID(10),
          locationCode: 'A-01-01',
          zoneName: 'Calzado dama',
          colorHex: '#2563EB',
          isStaging: false,
          quantity: 4,
          reservedQty: 1,
          available: 3,
        },
        {
          rackId: UUID(15),
          locationCode: 'STG-01-01',
          zoneName: 'Staging',
          colorHex: null,
          isStaging: true,
          quantity: 2,
          reservedQty: 0,
          available: 2,
        },
      ],
      otherBranches: [
        { branchId: UUID(40), code: 'S2', name: 'Sucursal 2', phone: '5512345678', available: 2 },
      ],
    };
    expect(
      LocateResultDto.safeParse({ product: listItem, variants: [locateVariant] }).success,
    ).toBe(true);
    expect(
      LocateResultDto.safeParse({
        product: listItem,
        variants: [{ ...locateVariant, otherBranches: null }],
      }).success,
    ).toBe(true);
    expect(
      LocateResultDto.safeParse({
        product: listItem,
        variants: [
          {
            ...locateVariant,
            otherBranches: [{ ...locateVariant.otherBranches[0], available: 0 }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('SuggestionsDto admite hasta 10 sugerencias', () => {
    const suggestion = {
      rackId: UUID(10),
      locationCode: 'A-01-01',
      zoneName: 'Calzado dama',
      colorHex: null,
      free: 30,
      level: 'green',
      reason: 'SAME_VARIANT',
    };
    expect(SuggestionsDto.safeParse({ fitsAll: true, suggestions: [suggestion] }).success).toBe(
      true,
    );
    expect(
      SuggestionsDto.safeParse({ fitsAll: false, suggestions: Array(11).fill(suggestion) }).success,
    ).toBe(false);
  });

  it('MovementRowDto', () => {
    expect(
      MovementRowDto.safeParse({
        ...movement,
        sku: 'ZAP0101-25-NEG',
        productName: 'Zapato de piel dama',
        variantLabel: '25 · Negro',
        fromLocationCode: null,
        toLocationCode: 'A-01-01',
        user: { id: UUID(30), fullName: 'Ana Almacén' },
      }).success,
    ).toBe(true);
  });

  it('LocationLabelDto y NodeContentDto', () => {
    expect(
      LocationLabelDto.safeParse({
        rackId: UUID(10),
        locationCode: 'A-01-03',
        qrPayload: 'LOC:A-01-03',
        zoneCode: 'A',
        zoneName: 'Calzado dama',
        containerName: null,
        capacityUnits: 40,
        isStaging: false,
        colorHex: '#2563EB',
        colorName: 'Azul',
      }).success,
    ).toBe(true);
    expect(
      NodeContentDto.safeParse({
        node: {
          kind: 'rack',
          id: UUID(10),
          code: 'A-01-01',
          name: null,
          isStaging: false,
          isActive: true,
          colorHex: '#2563EB',
          occupancy,
        },
        items: [
          {
            variantId: UUID(2),
            sku: 'ZAP0101-25-NEG',
            productName: 'Zapato de piel dama',
            variantLabel: '25 · Negro',
            thumbUrl: null,
            quantity: 4,
            reservedQty: 1,
            available: 3,
            stock: { status: 'DISPONIBLE', enPiso: true, enStaging: false },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }).success,
    ).toBe(true);
  });
});
