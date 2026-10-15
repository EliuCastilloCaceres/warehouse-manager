import { z } from 'zod';
import { NonNegativeInt, Uuid } from './common.js';
import { ContainerDto, RackDto, WarehouseDto, ZoneDto } from './dto/warehouse.js';
import { SegmentCodeSchema, STAGING_ZONE_CODE, ZoneCodeSchema } from './locationCode.js';

/** Paleta fija de colores de ubicación (spec F7 §3): la térmica imprime el nombre. */
export const LOCATION_COLORS = [
  { name: 'Rojo', hex: '#DC2626' },
  { name: 'Naranja', hex: '#EA580C' },
  { name: 'Amarillo', hex: '#EAB308' },
  { name: 'Verde', hex: '#16A34A' },
  { name: 'Turquesa', hex: '#0D9488' },
  { name: 'Azul', hex: '#2563EB' },
  { name: 'Morado', hex: '#7C3AED' },
  { name: 'Rosa', hex: '#DB2777' },
  { name: 'Café', hex: '#92400E' },
  { name: 'Gris', hex: '#6B7280' },
] as const;

type LocationColorHex = (typeof LOCATION_COLORS)[number]['hex'];

export const LocationColor = z.enum(
  LOCATION_COLORS.map((c) => c.hex) as [LocationColorHex, ...LocationColorHex[]],
  'Elige un color de la paleta',
);
export type LocationColor = z.infer<typeof LocationColor>;

/** `'#2563EB'` → `"Azul"`; `null` si no es de la paleta. */
export function colorName(hex: string | null): string | null {
  if (!hex) return null;
  const upper = hex.toUpperCase();
  return LOCATION_COLORS.find((c) => c.hex === upper)?.name ?? null;
}

export type OccupancyLevel = 'green' | 'amber' | 'red' | 'none';

/** Verde < 70 %, ámbar de 70 % a 90 % (inclusive) y rojo > 90 %; capacidad 0 → `none` (plan §4.3). */
export function occupancyLevel(occupied: number, capacity: number): OccupancyLevel {
  if (capacity <= 0) return 'none';
  // En enteros, igual que `CapacityBar` (F3), para no depender del redondeo.
  if (occupied * 100 < capacity * 70) return 'green';
  if (occupied * 100 <= capacity * 90) return 'amber';
  return 'red';
}

export const STOCK_STATUSES = ['AGOTADO', 'BAJO', 'DISPONIBLE'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * Estado de una variante en la sucursal (spec F7 §2): `AGOTADO` sin ninguna unidad; `BAJO` si
 * lo disponible no pasa del umbral (incluye 0 disponibles con unidades en piso); si no, `DISPONIBLE`.
 */
export function variantStockStatus(
  s: { quantity: number; reservedQty: number; stagingQuantity: number },
  lowStockThreshold: number,
): { status: StockStatus; enPiso: boolean; enStaging: boolean } {
  const available = s.quantity - s.reservedQty;
  const status: StockStatus =
    s.quantity === 0 ? 'AGOTADO' : available <= lowStockThreshold ? 'BAJO' : 'DISPONIBLE';
  return { status, enPiso: s.reservedQty > 0, enStaging: s.stagingQuantity > 0 };
}

/** Filtro de estado del mapa y del contenido de un nodo. */
export const StockFilter = z.enum(['AGOTADO', 'BAJO', 'EN_PISO', 'EN_STAGING']);
export type StockFilter = z.infer<typeof StockFilter>;

/** Contenedor o rack: `"1"` → `"01"`; fuera de `01`–`99` → error. */
export const SegmentCode = z
  .string()
  .trim()
  .transform((v) => v.padStart(2, '0'))
  .pipe(SegmentCodeSchema);

const ZoneCode = ZoneCodeSchema.refine(
  (c) => c !== STAGING_ZONE_CODE,
  `${STAGING_ZONE_CODE} está reservado`,
);
const ZoneName = z.string().trim().min(1, 'El nombre es obligatorio').max(60);
const ContainerName = z
  .string()
  .trim()
  .max(60)
  .transform((v) => (v === '' ? null : v))
  .nullable();

const atLeastOne = { message: 'Debes cambiar al menos un campo' };

export const ZoneCreateInput = z.object({
  code: ZoneCode.optional(),
  name: ZoneName,
  color: LocationColor.nullable().default(null),
  priority: NonNegativeInt.default(0),
  sortOrder: NonNegativeInt.default(0),
});
export type ZoneCreateInput = z.infer<typeof ZoneCreateInput>;

// Los `Update` se escriben sin `default` para que un campo omitido no se sobrescriba.
export const ZoneUpdateInput = z
  .strictObject({
    code: ZoneCode.optional(),
    name: ZoneName.optional(),
    color: LocationColor.nullable().optional(),
    priority: NonNegativeInt.optional(),
    sortOrder: NonNegativeInt.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, atLeastOne);
export type ZoneUpdateInput = z.infer<typeof ZoneUpdateInput>;

export const ContainerCreateInput = z.object({
  code: SegmentCode.optional(),
  name: ContainerName.default(null),
});
export type ContainerCreateInput = z.infer<typeof ContainerCreateInput>;

export const ContainerUpdateInput = z
  .strictObject({ code: SegmentCode.optional(), name: ContainerName.optional() })
  .refine((v) => Object.keys(v).length > 0, atLeastOne);
export type ContainerUpdateInput = z.infer<typeof ContainerUpdateInput>;

export const RackCreateInput = z.object({
  code: SegmentCode.optional(),
  capacityUnits: NonNegativeInt,
  labelColor: LocationColor.nullable().default(null),
});
export type RackCreateInput = z.infer<typeof RackCreateInput>;

export const RackUpdateInput = z
  .strictObject({
    code: SegmentCode.optional(),
    capacityUnits: NonNegativeInt.optional(),
    labelColor: LocationColor.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, atLeastOne);
export type RackUpdateInput = z.infer<typeof RackUpdateInput>;

export const STRUCTURE_SEGMENT_MAX = 99;

export const ContainerBatchInput = z
  .object({
    count: z.number().int().min(1).max(STRUCTURE_SEGMENT_MAX),
    racksPerContainer: z.number().int().min(1).max(STRUCTURE_SEGMENT_MAX).optional(),
    capacityUnits: NonNegativeInt.optional(),
    labelColor: LocationColor.nullable().default(null),
  })
  .refine((v) => !v.racksPerContainer || v.capacityUnits !== undefined, {
    path: ['capacityUnits'],
    message: 'Indica la capacidad de los racks',
  });
export type ContainerBatchInput = z.infer<typeof ContainerBatchInput>;

export const RackBatchInput = z.object({
  count: z.number().int().min(1).max(STRUCTURE_SEGMENT_MAX),
  capacityUnits: NonNegativeInt,
  labelColor: LocationColor.nullable().default(null),
});
export type RackBatchInput = z.infer<typeof RackBatchInput>;

const BooleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const WarehouseTreeQuery = z.object({
  includeInactive: BooleanQuery,
  status: StockFilter.optional(),
});
export type WarehouseTreeQuery = z.infer<typeof WarehouseTreeQuery>;

export const OccupancyLevelSchema = z.enum(['green', 'amber', 'red', 'none']);

export const OccupancyDto = z.object({
  capacity: NonNegativeInt,
  occupied: NonNegativeInt,
  reserved: NonNegativeInt,
  free: z.number().int(), // negativo si la capacidad quedó por debajo de la ocupación
  pct: z.number().nullable(), // null con capacidad 0
  level: OccupancyLevelSchema,
});
export type OccupancyDto = z.infer<typeof OccupancyDto>;

export const RackNodeDto = RackDto.extend({
  occupancy: OccupancyDto,
  colorHex: z.string().nullable(),
  matchCount: NonNegativeInt.optional(),
});
export type RackNodeDto = z.infer<typeof RackNodeDto>;

export const ContainerNodeDto = ContainerDto.extend({
  occupancy: OccupancyDto,
  racks: z.array(RackNodeDto),
  matchCount: NonNegativeInt.optional(),
});
export type ContainerNodeDto = z.infer<typeof ContainerNodeDto>;

export const ZoneNodeDto = ZoneDto.extend({
  occupancy: OccupancyDto,
  containers: z.array(ContainerNodeDto),
  matchCount: NonNegativeInt.optional(),
});
export type ZoneNodeDto = z.infer<typeof ZoneNodeDto>;

export const WarehouseTreeDto = z.object({
  warehouse: WarehouseDto,
  totals: OccupancyDto,
  staging: z.object({
    rackId: Uuid,
    locationCode: z.string(),
    occupied: NonNegativeInt,
    reserved: NonNegativeInt,
    matchCount: NonNegativeInt.optional(),
  }),
  zones: z.array(ZoneNodeDto),
});
export type WarehouseTreeDto = z.infer<typeof WarehouseTreeDto>;

export const StructureChangeDto = z.object({
  affectedRacks: NonNegativeInt,
  overCapacity: z.boolean(),
});
export type StructureChangeDto = z.infer<typeof StructureChangeDto>;

// Respuestas de `PATCH`: la entidad más el resumen del cambio.
export const ZoneChangeDto = ZoneDto.extend(StructureChangeDto.shape);
export type ZoneChangeDto = z.infer<typeof ZoneChangeDto>;
export const ContainerChangeDto = ContainerDto.extend(StructureChangeDto.shape);
export type ContainerChangeDto = z.infer<typeof ContainerChangeDto>;
export const RackChangeDto = RackDto.extend(StructureChangeDto.shape);
export type RackChangeDto = z.infer<typeof RackChangeDto>;

export const LOCATION_LABELS_MAX = 500;

export const LabelScope = z.enum(['warehouse', 'zone', 'container', 'rack']);
export type LabelScope = z.infer<typeof LabelScope>;

export const LocationLabelsQuery = z
  .object({
    scope: LabelScope,
    ids: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
        z.array(Uuid).max(LOCATION_LABELS_MAX),
      )
      .optional(),
  })
  .refine((v) => v.scope === 'warehouse' || (v.ids?.length ?? 0) > 0, {
    path: ['ids'],
    message: 'Elige al menos una ubicación',
  });
export type LocationLabelsQuery = z.infer<typeof LocationLabelsQuery>;

export const LocationLabelDto = z.object({
  rackId: Uuid,
  locationCode: z.string(),
  qrPayload: z.string(),
  zoneCode: z.string(),
  zoneName: z.string(),
  containerName: z.string().nullable(),
  capacityUnits: NonNegativeInt,
  isStaging: z.boolean(),
  colorHex: z.string().nullable(),
  colorName: z.string().nullable(),
});
export type LocationLabelDto = z.infer<typeof LocationLabelDto>;
