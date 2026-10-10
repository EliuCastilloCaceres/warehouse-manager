import type { AdjustmentReason, InventoryReferenceType } from '@warehouse-manager/shared';
import type { InventoryMovement } from '../../generated/prisma/client.js';

/** Datos comunes de todo movimiento de inventario. */
export interface MovementOptions {
  userId: string;
  note?: string | null;
  adjustmentReason?: AdjustmentReason | null;
  reference?: { type: InventoryReferenceType; id: string } | null;
}

export interface ReceiveInput extends MovementOptions {
  type: 'INITIAL_LOAD' | 'PUTAWAY' | 'ADJUSTMENT_IN';
  variantId: string;
  rackId: string;
  quantity: number;
  /** El usuario tiene `inventory.override_capacity` y lo confirmó (lo decide la ruta). */
  overrideCapacity?: boolean;
}

export interface RelocateInput extends MovementOptions {
  variantId: string;
  fromRackId: string;
  toRackId: string;
  quantity: number;
  overrideCapacity?: boolean;
}

export interface MoveReservedToStagingInput extends MovementOptions {
  variantId: string;
  fromRackId: string;
  quantity: number;
}

/** `pick`, `release`, `sell` y `adjustOut`. */
export interface RackQuantityInput extends MovementOptions {
  variantId: string;
  rackId: string;
  quantity: number;
}

export interface ReturnToStagingInput extends MovementOptions {
  variantId: string;
  warehouseId: string;
  quantity: number;
}

export interface StockBalance {
  rackId: string;
  quantity: number;
  reservedQty: number;
}

export interface InventoryResult {
  movement: InventoryMovement;
  balances: StockBalance[];
}
