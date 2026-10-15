import { z } from 'zod';
import { NonNegativeInt, Quantity, Uuid } from './common.js';
import { InventoryMovementDto } from './dto/warehouse.js';
import { AdjustmentReason, InventoryMovementType } from './enums.js';
import { paginated, PaginationQuery } from './pagination.js';
import { ProductListItemDto, StockSummary, VariantDetailDto } from './products.js';
import { OccupancyDto, OccupancyLevelSchema, STOCK_STATUSES, StockFilter } from './warehouse.js';

export const StockStatusDto = z.object({
  status: z.enum(STOCK_STATUSES),
  enPiso: z.boolean(),
  enStaging: z.boolean(),
});
export type StockStatusDto = z.infer<typeof StockStatusDto>;

export const ContentRowDto = z.object({
  variantId: Uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  quantity: NonNegativeInt,
  reservedQty: NonNegativeInt,
  available: NonNegativeInt,
  stock: StockStatusDto, // estado de la variante en la sucursal
});
export type ContentRowDto = z.infer<typeof ContentRowDto>;

export const ContentQuery = PaginationQuery.extend({ status: StockFilter.optional() });
export type ContentQuery = z.infer<typeof ContentQuery>;

/** Nodo (zona, contenedor o rack) cuyo contenido se consulta. */
export const ContentNodeDto = z.object({
  kind: z.enum(['zone', 'container', 'rack']),
  id: Uuid,
  code: z.string(), // "A", "A-01" o "A-01-03"
  name: z.string().nullable(),
  isStaging: z.boolean(),
  isActive: z.boolean(),
  colorHex: z.string().nullable(),
  occupancy: OccupancyDto,
});
export type ContentNodeDto = z.infer<typeof ContentNodeDto>;

export const NodeContentDto = paginated(ContentRowDto).extend({ node: ContentNodeDto });
export type NodeContentDto = z.infer<typeof NodeContentDto>;

export const ByLocationQuery = ContentQuery.extend({ code: z.string().trim().min(1).max(20) });
export type ByLocationQuery = z.infer<typeof ByLocationQuery>;

export const LocationRowDto = z.object({
  rackId: Uuid,
  locationCode: z.string(),
  zoneName: z.string(),
  colorHex: z.string().nullable(),
  isStaging: z.boolean(),
  quantity: NonNegativeInt,
  reservedQty: NonNegativeInt,
  available: NonNegativeInt,
});
export type LocationRowDto = z.infer<typeof LocationRowDto>;

export const OtherBranchStockDto = z.object({
  branchId: Uuid,
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  available: Quantity,
});
export type OtherBranchStockDto = z.infer<typeof OtherBranchStockDto>;

export const LocateQuery = z.object({ code: z.string().trim().min(1).max(100) });
export type LocateQuery = z.infer<typeof LocateQuery>;

export const LocateVariantDto = z.object({
  variant: VariantDetailDto, // F6
  totals: StockSummary,
  stock: StockStatusDto,
  locations: z.array(LocationRowDto),
  otherBranches: z.array(OtherBranchStockDto).nullable(), // null = sin permiso
});
export type LocateVariantDto = z.infer<typeof LocateVariantDto>;

export const LocateResultDto = z.object({
  product: ProductListItemDto,
  variants: z.array(LocateVariantDto),
});
export type LocateResultDto = z.infer<typeof LocateResultDto>;

export const SUGGESTIONS_MAX = 10;

export const SuggestQuery = z.object({
  variantId: Uuid,
  quantity: z.coerce.number().int().min(1).max(10_000),
});
export type SuggestQuery = z.infer<typeof SuggestQuery>;

export const SuggestionReason = z.enum(['SAME_VARIANT', 'SAME_PRODUCT', 'FREE_SPACE']);
export type SuggestionReason = z.infer<typeof SuggestionReason>;

export const SuggestionDto = z.object({
  rackId: Uuid,
  locationCode: z.string(),
  zoneName: z.string(),
  colorHex: z.string().nullable(),
  free: z.number().int(),
  level: OccupancyLevelSchema,
  reason: SuggestionReason,
});
export type SuggestionDto = z.infer<typeof SuggestionDto>;

export const SuggestionsDto = z.object({
  fitsAll: z.boolean(),
  suggestions: z.array(SuggestionDto).max(SUGGESTIONS_MAX),
});
export type SuggestionsDto = z.infer<typeof SuggestionsDto>;

export const PutawaySource = z.enum(['STAGING', 'NEW']);
export type PutawaySource = z.infer<typeof PutawaySource>;

export const PutawayInput = z.object({
  variantId: Uuid,
  rackId: Uuid,
  quantity: Quantity,
  source: PutawaySource,
  overrideCapacity: z.boolean().default(false),
});
export type PutawayInput = z.infer<typeof PutawayInput>;

export const PUTAWAY_BATCH_MAX = 100;

export const PutawayBatchInput = z
  .object({
    rackId: Uuid,
    overrideCapacity: z.boolean().default(false),
    items: z
      .array(z.object({ variantId: Uuid, quantity: Quantity, source: PutawaySource }))
      .min(1)
      .max(PUTAWAY_BATCH_MAX),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'variantId'],
          message: 'Ese producto está repetido en el lote',
        });
      }
      seen.add(item.variantId);
    });
  });
export type PutawayBatchInput = z.infer<typeof PutawayBatchInput>;

export const RelocateInput = z
  .object({
    fromRackId: Uuid,
    toRackId: Uuid,
    overrideCapacity: z.boolean().default(false),
    items: z
      .array(z.object({ variantId: Uuid, quantity: Quantity }))
      .min(1)
      .max(200)
      .optional(),
    all: z.literal(true).optional(),
  })
  .refine((v) => Boolean(v.items) !== Boolean(v.all), 'Indica los productos o "todo", no ambos')
  .refine((v) => v.fromRackId !== v.toRackId, {
    path: ['toRackId'],
    message: 'El destino debe ser distinto del origen',
  });
export type RelocateInput = z.infer<typeof RelocateInput>;

export const AdjustDirection = z.enum(['IN', 'OUT']);
export type AdjustDirection = z.infer<typeof AdjustDirection>;

export const AdjustInput = z.object({
  variantId: Uuid,
  rackId: Uuid,
  direction: AdjustDirection,
  quantity: Quantity,
  reason: AdjustmentReason,
  note: z.string().trim().min(1, 'La nota es obligatoria').max(300),
  overrideCapacity: z.boolean().default(false),
});
export type AdjustInput = z.infer<typeof AdjustInput>;

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  PHYSICAL_COUNT: 'Conteo físico',
  DAMAGE: 'Merma o daño',
  LOSS: 'Extravío',
  FOUND: 'Hallazgo',
  DATA_ENTRY_ERROR: 'Error de captura',
  OTHER: 'Otro',
};

export const StockBalanceDto = z.object({
  rackId: Uuid,
  variantId: Uuid,
  quantity: NonNegativeInt,
  reservedQty: NonNegativeInt,
});
export type StockBalanceDto = z.infer<typeof StockBalanceDto>;

export const StockOperationDto = z.object({
  movements: z.array(InventoryMovementDto),
  balances: z.array(StockBalanceDto),
});
export type StockOperationDto = z.infer<typeof StockOperationDto>;

/** Fecha local `YYYY-MM-DD` (se interpreta en la zona horaria de la sucursal). */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');

export const MovementListQuery = PaginationQuery.extend({
  variantId: Uuid.optional(),
  sku: z.string().trim().min(1).optional(),
  rackId: Uuid.optional(),
  locationCode: z.string().trim().min(1).optional(),
  types: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
      z.array(InventoryMovementType),
    )
    .optional(),
  userId: Uuid.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
}).refine((v) => !v.from || !v.to || v.from <= v.to, {
  path: ['to'],
  message: '"Hasta" debe ser igual o posterior a "Desde"',
});
export type MovementListQuery = z.infer<typeof MovementListQuery>;

export const MovementRowDto = InventoryMovementDto.extend({
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  fromLocationCode: z.string().nullable(),
  toLocationCode: z.string().nullable(),
  user: z.object({ id: Uuid, fullName: z.string() }),
});
export type MovementRowDto = z.infer<typeof MovementRowDto>;

/** Página del kardex con la zona horaria de la sucursal, para mostrar las fechas. */
export const MovementPageDto = paginated(MovementRowDto).extend({ timezone: z.string() });
export type MovementPageDto = z.infer<typeof MovementPageDto>;
