import {
  AdjustInput,
  ByLocationQuery,
  type InventoryMovementDto,
  LocateQuery,
  LocateResultDto,
  MovementListQuery,
  MovementPageDto,
  NodeContentDto,
  type PermissionCode,
  PutawayBatchInput,
  PutawayInput,
  type PutawaySource,
  RelocateInput,
  StockOperationDto,
  SuggestionsDto,
  SuggestQuery,
} from '@warehouse-manager/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { DomainError, validationError } from '../../core/errors.js';
import type { InventoryMovement, Prisma } from '../../generated/prisma/client.js';
import * as warehouseRepo from '../warehouse/warehouse.repository.js';
import { InventoryQueries } from './inventory.queries.js';
import * as repo from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';
import type { InventoryResult } from './inventory.types.js';

type Tx = Prisma.TransactionClient;

const READ = { access: { permission: 'warehouse.read' }, branchScoped: true } as const;

interface Actor {
  userId: string;
  branchIds: readonly string[];
  permissions: readonly PermissionCode[];
  ip: string | null;
}

function actorOf(request: FastifyRequest): Actor {
  const auth = request.auth!;
  return {
    userId: auth.userId,
    branchIds: auth.branchIds,
    permissions: auth.permissions,
    ip: request.ip,
  };
}

function toMovementDto(movement: InventoryMovement): InventoryMovementDto {
  return { ...movement, createdAt: movement.createdAt.toISOString() };
}

type StockOperation = {
  movements: InventoryMovementDto[];
  balances: StockOperationDto['balances'];
};

function toOperation(results: InventoryResult[]): StockOperation {
  return {
    movements: results.map((r) => toMovementDto(r.movement)),
    balances: results.flatMap((r) =>
      r.balances.map((b) => ({ ...b, variantId: r.movement.variantId })),
    ),
  };
}

/** Error de un ítem de un lote, con su posición (`details.itemIndex`). */
function withItemIndex(error: unknown, itemIndex: number): unknown {
  if (!(error instanceof DomainError)) return error;
  const details =
    error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details
      : error.details === undefined
        ? {}
        : { issues: error.details };
  return new DomainError(error.code, {
    message: error.message,
    details: { ...details, itemIndex },
  });
}

/** Ubicar, reubicar y ajustar sobre `InventoryService` (spec F7 §3), cada uno en una transacción. */
class StockOperations {
  private readonly inventory = new InventoryService();

  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  /** `overrideCapacity` exige `inventory.override_capacity`. */
  private assertOverride(actor: Actor, overrideCapacity: boolean): void {
    if (overrideCapacity && !actor.permissions.includes('inventory.override_capacity')) {
      throw new DomainError('FORBIDDEN', {
        details: { permission: 'inventory.override_capacity' },
      });
    }
  }

  /** Rack existente de un almacén de las sucursales del actor. */
  private async rackOf(actor: Actor, rackId: string, db: Tx) {
    const rack = await warehouseRepo.findRack(db, rackId);
    if (!rack) throw new DomainError('NOT_FOUND', { message: 'No se encontró el rack.' });
    if (!actor.branchIds.includes(rack.container.zone.warehouse.branchId)) {
      throw new DomainError('BRANCH_FORBIDDEN');
    }
    return rack;
  }

  private async putawayOne(
    tx: Tx,
    actor: Actor,
    rack: { id: string; warehouseId: string },
    item: { variantId: string; quantity: number; source: PutawaySource },
    overrideCapacity: boolean,
  ): Promise<InventoryResult> {
    if (item.source === 'NEW') {
      return this.inventory.receive(tx, {
        type: 'PUTAWAY',
        variantId: item.variantId,
        rackId: rack.id,
        quantity: item.quantity,
        userId: actor.userId,
        overrideCapacity,
      });
    }
    const stagingId = await repo.findStagingRackId(tx, rack.warehouseId);
    if (!stagingId) {
      throw new DomainError('INVENTORY_INVALID_OPERATION', {
        message: 'El almacén no tiene un staging activo.',
      });
    }
    return this.inventory.relocate(tx, {
      variantId: item.variantId,
      fromRackId: stagingId,
      toRackId: rack.id,
      quantity: item.quantity,
      userId: actor.userId,
      overrideCapacity,
    });
  }

  /** Destino de ubicar: no puede ser staging. */
  private async putawayTarget(actor: Actor, rackId: string, tx: Tx) {
    const rack = await this.rackOf(actor, rackId, tx);
    if (rack.container.zone.isStaging) {
      throw validationError('rackId', 'El destino no puede ser staging');
    }
    return rack;
  }

  async putaway(actor: Actor, input: PutawayInput): Promise<StockOperation> {
    this.assertOverride(actor, input.overrideCapacity);
    const result = await this.prisma.$transaction(async (tx) => {
      const rack = await this.putawayTarget(actor, input.rackId, tx);
      return this.putawayOne(tx, actor, rack, input, input.overrideCapacity);
    });
    return toOperation([result]);
  }

  /** Todo o nada: si un ítem falla, no se aplica ninguno. */
  async putawayBatch(actor: Actor, input: PutawayBatchInput): Promise<StockOperation> {
    this.assertOverride(actor, input.overrideCapacity);
    const results = await this.prisma.$transaction(async (tx) => {
      const rack = await this.putawayTarget(actor, input.rackId, tx);
      const done: InventoryResult[] = [];
      for (const [i, item] of input.items.entries()) {
        try {
          done.push(await this.putawayOne(tx, actor, rack, item, input.overrideCapacity));
        } catch (error) {
          throw withItemIndex(error, i);
        }
      }
      return done;
    });
    return toOperation(results);
  }

  /** Ítems indicados o, con `all`, todas las unidades disponibles de cada variante del origen. */
  async relocate(actor: Actor, input: RelocateInput): Promise<StockOperation> {
    this.assertOverride(actor, input.overrideCapacity);
    const results = await this.prisma.$transaction(async (tx) => {
      await this.rackOf(actor, input.fromRackId, tx);
      await this.rackOf(actor, input.toRackId, tx);
      await repo.lockRacks(tx, [input.fromRackId, input.toRackId]);
      const items = input.all ? await this.availableIn(tx, input.fromRackId) : input.items!;
      if (items.length === 0) {
        throw new DomainError('STOCK_INSUFFICIENT', {
          message: 'No hay unidades disponibles para mover.',
          details: { available: 0 },
        });
      }
      const done: InventoryResult[] = [];
      for (const [i, item] of items.entries()) {
        try {
          done.push(
            await this.inventory.relocate(tx, {
              variantId: item.variantId,
              fromRackId: input.fromRackId,
              toRackId: input.toRackId,
              quantity: item.quantity,
              userId: actor.userId,
              overrideCapacity: input.overrideCapacity,
            }),
          );
        } catch (error) {
          throw withItemIndex(error, i);
        }
      }
      return done;
    });
    return toOperation(results);
  }

  /** Unidades disponibles (sin las reservadas) de cada variante del rack. */
  private async availableIn(tx: Tx, rackId: string) {
    const rows = await tx.stockLocation.findMany({
      where: { rackId },
      select: { variantId: true, quantity: true, reservedQty: true },
      orderBy: { variant: { sku: 'asc' } },
    });
    return rows
      .map((row) => ({ variantId: row.variantId, quantity: row.quantity - row.reservedQty }))
      .filter((row) => row.quantity > 0);
  }

  /** Ajuste con motivo y nota; queda en el kardex y en el audit. */
  async adjust(actor: Actor, input: AdjustInput): Promise<StockOperation> {
    this.assertOverride(actor, input.overrideCapacity);
    const result = await this.prisma.$transaction(async (tx) => {
      const rack = await this.rackOf(actor, input.rackId, tx);
      const common = {
        variantId: input.variantId,
        rackId: rack.id,
        quantity: input.quantity,
        userId: actor.userId,
        note: input.note,
        adjustmentReason: input.reason,
      };
      const result =
        input.direction === 'IN'
          ? await this.inventory.receive(tx, {
              ...common,
              type: 'ADJUSTMENT_IN',
              overrideCapacity: input.overrideCapacity,
            })
          : await this.inventory.adjustOut(tx, common);
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'inventory.adjust',
          entity: 'InventoryMovement',
          entityId: result.movement.id,
          payload: {
            variantId: input.variantId,
            rackId: rack.id,
            locationCode: rack.locationCode,
            direction: input.direction,
            quantity: input.quantity,
            reason: input.reason,
            note: input.note,
          },
          ip: actor.ip,
        },
        tx,
      );
      return result;
    });
    return toOperation([result]);
  }
}

/** `/inventory`: buscar, ubicar, reubicar, ajustar y kardex (spec F7 §6). */
export const inventoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const queries = new InventoryQueries(app);
  const operations = new StockOperations(app);
  const tags = ['inventory'];

  app.get(
    '/locate',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Dónde está un producto (SKU de variante, código de barras o SKU padre)',
        querystring: LocateQuery,
        response: { 200: LocateResultDto },
      },
    },
    async (request) =>
      queries.locate(request.query.code, request.branchId!, request.auth!.permissions),
  );

  app.get(
    '/by-location',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Contenido de una ubicación por su código',
        querystring: ByLocationQuery,
        response: { 200: NodeContentDto },
      },
    },
    async (request) => {
      const { code, ...query } = request.query;
      return queries.byLocation(code, request.branchId!, query);
    },
  );

  app.get(
    '/suggest-locations',
    {
      config: { access: { permission: 'inventory.putaway' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Racks sugeridos para ubicar una variante',
        querystring: SuggestQuery,
        response: { 200: SuggestionsDto },
      },
    },
    async (request) =>
      queries.suggest(request.query.variantId, request.query.quantity, request.branchId!),
  );

  app.get(
    '/movements',
    {
      config: { access: { permission: 'inventory.movements.read' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Kardex de la sucursal',
        querystring: MovementListQuery,
        response: { 200: MovementPageDto },
      },
    },
    async (request) => queries.movements(request.query, request.branchId!),
  );

  app.post(
    '/putaway',
    {
      config: { access: { permission: 'inventory.putaway' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Ubicar desde staging o mercancía nueva',
        body: PutawayInput,
        response: { 200: StockOperationDto },
      },
    },
    async (request) => operations.putaway(actorOf(request), request.body),
  );

  app.post(
    '/putaway/batch',
    {
      config: { access: { permission: 'inventory.putaway' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Ubicar varios productos en un rack (todo o nada)',
        body: PutawayBatchInput,
        response: { 200: StockOperationDto },
      },
    },
    async (request) => operations.putawayBatch(actorOf(request), request.body),
  );

  app.post(
    '/relocate',
    {
      config: { access: { permission: 'inventory.relocate' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Reubicar productos entre racks del mismo almacén',
        body: RelocateInput,
        response: { 200: StockOperationDto },
      },
    },
    async (request) => operations.relocate(actorOf(request), request.body),
  );

  app.post(
    '/adjust',
    {
      config: { access: { permission: 'inventory.adjust' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Ajuste de inventario con motivo y nota',
        body: AdjustInput,
        response: { 200: StockOperationDto },
      },
    },
    async (request) => operations.adjust(actorOf(request), request.body),
  );
};
