import { AdjustmentReason, type InventoryMovementType, Quantity } from '@warehouse-manager/shared';
import { DomainError, validationError } from '../../core/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import * as repo from './inventory.repository.js';
import type { RackRow } from './inventory.repository.js';
import type {
  InventoryResult,
  MoveReservedToStagingInput,
  MovementOptions,
  RackQuantityInput,
  ReceiveInput,
  RelocateInput,
  ReturnToStagingInput,
  StockBalance,
} from './inventory.types.js';

type Tx = Prisma.TransactionClient;

const notFound = (what: 'rack' | 'variante') =>
  new DomainError('NOT_FOUND', {
    message: `No se encontró el ${what === 'rack' ? 'rack' : 'producto'}.`,
  });

function assertQuantity(quantity: number): void {
  if (!Quantity.safeParse(quantity).success) {
    throw validationError('quantity', 'La cantidad debe ser un entero mayor que 0');
  }
}

/** Los ajustes exigen nota y motivo; los demás movimientos no llevan motivo. */
function assertAdjustment(options: MovementOptions, isAdjustment: boolean): void {
  if (isAdjustment) {
    if (!options.note?.trim()) throw validationError('note', 'El ajuste requiere una nota');
    if (
      !options.adjustmentReason ||
      !AdjustmentReason.safeParse(options.adjustmentReason).success
    ) {
      throw validationError('adjustmentReason', 'El ajuste requiere un motivo');
    }
  } else if (options.adjustmentReason) {
    throw validationError('adjustmentReason', 'Solo los ajustes llevan motivo');
  }
}

async function assertVariant(tx: Tx, variantId: string): Promise<void> {
  if (!(await repo.variantExists(tx, variantId))) throw notFound('variante');
}

async function lockOne(tx: Tx, rackId: string): Promise<RackRow> {
  const [rack] = await repo.lockRacks(tx, [rackId]);
  if (!rack) throw notFound('rack');
  return rack;
}

/** Capacidad del destino (spec F2 §8): staging la ignora; con `overrideCapacity` se marca. */
async function checkCapacity(
  tx: Tx,
  rack: RackRow,
  requested: number,
  overrideCapacity = false,
): Promise<boolean> {
  if (rack.isStaging) return false;
  const occupied = await repo.occupiedUnits(tx, rack.id);
  if (occupied + requested <= rack.capacityUnits) return false;
  if (overrideCapacity) return true;
  throw new DomainError('RACK_CAPACITY_EXCEEDED', {
    details: {
      rackId: rack.id,
      locationCode: rack.locationCode,
      capacity: rack.capacityUnits,
      occupied,
      requested,
    },
  });
}

async function insufficientStock(tx: Tx, variantId: string, rackId: string, requested: number) {
  const available = await repo.availableUnits(tx, variantId, rackId);
  return new DomainError('STOCK_INSUFFICIENT', { details: { available, requested } });
}

const invalidOperation = (message: string) =>
  new DomainError('INVENTORY_INVALID_OPERATION', { message });

/**
 * Núcleo de inventario (spec F2 §8). Cada método recibe el `tx` de quien llama, aplica su
 * movimiento de forma atómica y lo registra en el kardex. No consulta permisos.
 */
export class InventoryService {
  private async record(
    tx: Tx,
    type: InventoryMovementType,
    input: MovementOptions & { variantId: string; quantity: number },
    racks: { fromRackId?: string; toRackId?: string },
    capacityOverridden: boolean,
    balances: StockBalance[],
  ): Promise<InventoryResult> {
    const movement = await tx.inventoryMovement.create({
      data: {
        variantId: input.variantId,
        fromRackId: racks.fromRackId ?? null,
        toRackId: racks.toRackId ?? null,
        quantity: input.quantity,
        type,
        userId: input.userId,
        referenceType: input.reference?.type ?? null,
        referenceId: input.reference?.id ?? null,
        note: input.note ?? null,
        adjustmentReason: input.adjustmentReason ?? null,
        capacityOverridden,
      },
    });
    return { movement, balances };
  }

  /** Entrada a un rack: carga inicial, ubicación de mercancía o ajuste positivo. */
  async receive(tx: Tx, input: ReceiveInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, input.type === 'ADJUSTMENT_IN');
    const rack = await lockOne(tx, input.rackId);
    if (!rack.isActive) throw new DomainError('RACK_INACTIVE');
    await assertVariant(tx, input.variantId);
    const overridden = await checkCapacity(tx, rack, input.quantity, input.overrideCapacity);
    const balance = await repo.addQuantity(tx, input.variantId, rack.id, input.quantity);
    return this.record(tx, input.type, input, { toRackId: rack.id }, overridden, [
      { rackId: rack.id, ...balance },
    ]);
  }

  /** Reubica unidades disponibles entre dos racks del mismo almacén. */
  async relocate(tx: Tx, input: RelocateInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    if (input.fromRackId === input.toRackId) {
      throw invalidOperation('El origen y el destino son el mismo rack.');
    }
    const racks = await repo.lockRacks(tx, [input.fromRackId, input.toRackId]);
    const from = racks.find((r) => r.id === input.fromRackId);
    const to = racks.find((r) => r.id === input.toRackId);
    if (!from || !to) throw notFound('rack');
    if (!to.isActive) throw new DomainError('RACK_INACTIVE');
    if (from.warehouseId !== to.warehouseId) throw new DomainError('INVENTORY_CROSS_WAREHOUSE');
    await assertVariant(tx, input.variantId);
    const overridden = await checkCapacity(tx, to, input.quantity, input.overrideCapacity);

    const origin = await repo.takeAvailable(tx, input.variantId, from.id, input.quantity);
    if (!origin) throw await insufficientStock(tx, input.variantId, from.id, input.quantity);
    const destination = await repo.addQuantity(tx, input.variantId, to.id, input.quantity);
    return this.record(
      tx,
      'RELOCATE',
      input,
      { fromRackId: from.id, toRackId: to.id },
      overridden,
      [
        { rackId: from.id, ...origin },
        { rackId: to.id, ...destination },
      ],
    );
  }

  /** Lleva unidades reservadas (p. ej. de un carrito) al staging del mismo almacén. */
  async moveReservedToStaging(tx: Tx, input: MoveReservedToStagingInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    const origin = await repo.findRack(tx, input.fromRackId);
    if (!origin) throw notFound('rack');
    const stagingId = await repo.findStagingRackId(tx, origin.warehouseId);
    if (!stagingId) throw invalidOperation('El almacén no tiene un staging activo.');
    if (stagingId === origin.id) throw invalidOperation('El origen ya es el staging.');
    await repo.lockRacks(tx, [origin.id, stagingId]);

    const from = await repo.consumeReserved(tx, input.variantId, origin.id, input.quantity);
    if (!from) throw invalidOperation('No hay suficientes unidades reservadas.');
    const staging = await repo.addQuantity(tx, input.variantId, stagingId, input.quantity);
    return this.record(
      tx,
      'TO_STAGING',
      input,
      { fromRackId: origin.id, toRackId: stagingId },
      false,
      [
        { rackId: origin.id, ...from },
        { rackId: stagingId, ...staging },
      ],
    );
  }

  /** Reserva unidades disponibles (al agregar al carrito). */
  async pick(tx: Tx, input: RackQuantityInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    if (!(await repo.findRack(tx, input.rackId))) throw notFound('rack');
    await assertVariant(tx, input.variantId);
    const balance = await repo.reserve(tx, input.variantId, input.rackId, input.quantity);
    if (!balance) throw await insufficientStock(tx, input.variantId, input.rackId, input.quantity);
    return this.record(tx, 'PICK', input, { fromRackId: input.rackId }, false, [
      { rackId: input.rackId, ...balance },
    ]);
  }

  /** Libera unidades reservadas en su rack (regresan a estar disponibles). */
  async release(tx: Tx, input: RackQuantityInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    if (!(await repo.findRack(tx, input.rackId))) throw notFound('rack');
    const balance = await repo.unreserve(tx, input.variantId, input.rackId, input.quantity);
    if (!balance) throw invalidOperation('No hay suficientes unidades reservadas.');
    return this.record(tx, 'RETURN_TO_RACK', input, { toRackId: input.rackId }, false, [
      { rackId: input.rackId, ...balance },
    ]);
  }

  /** Vende unidades reservadas: baja existencia y reserva. */
  async sell(tx: Tx, input: RackQuantityInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    if (!(await repo.findRack(tx, input.rackId))) throw notFound('rack');
    const balance = await repo.consumeReserved(tx, input.variantId, input.rackId, input.quantity);
    if (!balance) throw invalidOperation('No hay suficientes unidades reservadas.');
    return this.record(tx, 'SALE', input, { fromRackId: input.rackId }, false, [
      { rackId: input.rackId, ...balance },
    ]);
  }

  /** Regresa al staging del almacén las unidades de una venta cancelada. */
  async returnCancelledSaleToStaging(
    tx: Tx,
    input: ReturnToStagingInput,
  ): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, false);
    const stagingId = await repo.findStagingRackId(tx, input.warehouseId);
    if (!stagingId) throw invalidOperation('El almacén no tiene un staging activo.');
    await lockOne(tx, stagingId);
    await assertVariant(tx, input.variantId);
    const balance = await repo.addQuantity(tx, input.variantId, stagingId, input.quantity);
    return this.record(tx, 'SALE_CANCEL', input, { toRackId: stagingId }, false, [
      { rackId: stagingId, ...balance },
    ]);
  }

  /** Ajuste negativo (merma, extravío…): solo unidades disponibles, con nota y motivo. */
  async adjustOut(tx: Tx, input: RackQuantityInput): Promise<InventoryResult> {
    assertQuantity(input.quantity);
    assertAdjustment(input, true);
    if (!(await repo.findRack(tx, input.rackId))) throw notFound('rack');
    await assertVariant(tx, input.variantId);
    const balance = await repo.takeAvailable(tx, input.variantId, input.rackId, input.quantity);
    if (!balance) throw await insufficientStock(tx, input.variantId, input.rackId, input.quantity);
    return this.record(tx, 'ADJUSTMENT_OUT', input, { fromRackId: input.rackId }, false, [
      { rackId: input.rackId, ...balance },
    ]);
  }
}
