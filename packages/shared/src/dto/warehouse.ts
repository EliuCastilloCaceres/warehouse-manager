import { z } from 'zod';
import { IsoDateTime, NonNegativeInt, Quantity, Uuid } from '../common.js';
import { AdjustmentReason, InventoryMovementType, InventoryReferenceType } from '../enums.js';

export const WarehouseDto = z.object({
  id: Uuid,
  branchId: Uuid,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WarehouseDto = z.infer<typeof WarehouseDto>;

export const ZoneDto = z.object({
  id: Uuid,
  warehouseId: Uuid,
  code: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  isStaging: z.boolean(),
  priority: NonNegativeInt,
  sortOrder: NonNegativeInt,
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ZoneDto = z.infer<typeof ZoneDto>;

export const ContainerDto = z.object({
  id: Uuid,
  zoneId: Uuid,
  code: z.string(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ContainerDto = z.infer<typeof ContainerDto>;

export const RackDto = z.object({
  id: Uuid,
  containerId: Uuid,
  warehouseId: Uuid,
  code: z.string(),
  locationCode: z.string(),
  capacityUnits: NonNegativeInt,
  labelColor: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RackDto = z.infer<typeof RackDto>;

export const StockLocationDto = z.object({
  id: Uuid,
  variantId: Uuid,
  rackId: Uuid,
  quantity: NonNegativeInt,
  reservedQty: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type StockLocationDto = z.infer<typeof StockLocationDto>;

export const InventoryMovementDto = z.object({
  id: Uuid,
  variantId: Uuid,
  fromRackId: Uuid.nullable(),
  toRackId: Uuid.nullable(),
  quantity: Quantity,
  type: InventoryMovementType,
  userId: Uuid,
  referenceType: InventoryReferenceType.nullable(),
  referenceId: Uuid.nullable(),
  note: z.string().nullable(),
  adjustmentReason: AdjustmentReason.nullable(),
  capacityOverridden: z.boolean(),
  createdAt: IsoDateTime,
});
export type InventoryMovementDto = z.infer<typeof InventoryMovementDto>;
