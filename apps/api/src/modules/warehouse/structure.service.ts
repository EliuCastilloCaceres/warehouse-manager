import type {
  ContainerBatchInput,
  ContainerChangeDto,
  ContainerCreateInput,
  ContainerDto,
  ContainerUpdateInput,
  RackBatchInput,
  RackChangeDto,
  RackCreateInput,
  RackDto,
  RackUpdateInput,
  WarehouseDto,
  ZoneChangeDto,
  ZoneCreateInput,
  ZoneDto,
  ZoneUpdateInput,
} from '@warehouse-manager/shared';
import { buildLocationCode } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import { type Container, Prisma, type Rack, type Zone } from '../../generated/prisma/client.js';
import { nextSegmentCodes, nextZoneCode } from './codes.js';
import * as repo from './warehouse.repository.js';
import type { Subtree } from './warehouse.repository.js';

type Tx = Prisma.TransactionClient;

/** Quien actúa: sus sucursales salen de los claims y la ip va al audit. */
export interface WarehouseActor {
  userId: string;
  branchIds: readonly string[];
  ip: string | null;
}

export type StructureKind = 'zone' | 'container' | 'rack';

const ENTITY: Record<StructureKind, string> = {
  zone: 'Zone',
  container: 'Container',
  rack: 'Rack',
};
const LABEL: Record<StructureKind, string> = {
  zone: 'la zona',
  container: 'el contenedor',
  rack: 'el rack',
};

const BATCH_TIMEOUT_MS = 60_000;

const iso = (date: Date) => date.toISOString();
const stamps = (row: { createdAt: Date; updatedAt: Date }) => ({
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export function toWarehouseDto(row: {
  id: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): WarehouseDto {
  const { id, branchId, code, name, isActive } = row;
  return { id, branchId, code, name, isActive, ...stamps(row) };
}

export function toZoneDto(row: Zone): ZoneDto {
  const { id, warehouseId, code, name, color, isStaging, priority, sortOrder, isActive } = row;
  return {
    id,
    warehouseId,
    code,
    name,
    color,
    isStaging,
    priority,
    sortOrder,
    isActive,
    ...stamps(row),
  };
}

export function toContainerDto(row: Container): ContainerDto {
  const { id, zoneId, code, name, isActive } = row;
  return { id, zoneId, code, name, isActive, ...stamps(row) };
}

export function toRackDto(row: Rack): RackDto {
  const { id, containerId, warehouseId, code, locationCode, capacityUnits, labelColor, isActive } =
    row;
  return {
    id,
    containerId,
    warehouseId,
    code,
    locationCode,
    capacityUnits,
    labelColor,
    isActive,
    ...stamps(row),
  };
}

const notFound = (kind: StructureKind | 'warehouse') =>
  new DomainError('NOT_FOUND', {
    message: `No se encontró ${kind === 'warehouse' ? 'el almacén' : LABEL[kind]}.`,
  });

const locked = () => new DomainError('STRUCTURE_LOCKED');

const duplicate = (kind: StructureKind) =>
  new DomainError('CONFLICT', {
    message: `Ya existe ${kind === 'zone' ? 'una zona' : kind === 'container' ? 'un contenedor' : 'un rack'} con ese código.`,
    details: { target: ['code'] },
  });

const inactiveParent = (parent: 'zone' | 'container') =>
  new DomainError('CONFLICT', {
    message: `Reactiva primero ${LABEL[parent]}.`,
    details: { parent },
  });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Configuración del almacén: zonas, contenedores y racks (spec F7 §3). */
export class StructureService {
  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  // ─── Lectura y acceso ──────────────────────────────────────────────────────

  async listWarehouses(branchId: string): Promise<WarehouseDto[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: { branchId, isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map(toWarehouseDto);
  }

  private assertBranch(actor: WarehouseActor, branchId: string): void {
    if (!actor.branchIds.includes(branchId)) throw new DomainError('BRANCH_FORBIDDEN');
  }

  async loadWarehouse(actor: WarehouseActor, id: string) {
    const warehouse = await repo.findWarehouse(this.prisma, id);
    if (!warehouse) throw notFound('warehouse');
    this.assertBranch(actor, warehouse.branchId);
    return warehouse;
  }

  async loadZone(actor: WarehouseActor, id: string, db: Prisma.TransactionClient = this.prisma) {
    const zone = await repo.findZone(db, id);
    if (!zone) throw notFound('zone');
    this.assertBranch(actor, zone.warehouse.branchId);
    return zone;
  }

  async loadContainer(actor: WarehouseActor, id: string, db: Tx = this.prisma) {
    const container = await repo.findContainer(db, id);
    if (!container) throw notFound('container');
    this.assertBranch(actor, container.zone.warehouse.branchId);
    return container;
  }

  async loadRack(actor: WarehouseActor, id: string, db: Tx = this.prisma) {
    const rack = await repo.findRack(db, id);
    if (!rack) throw notFound('rack');
    this.assertBranch(actor, rack.container.zone.warehouse.branchId);
    return rack;
  }

  /** Nodo con su almacén, staging y estado, para las operaciones genéricas. */
  private async loadNode(actor: WarehouseActor, kind: StructureKind, id: string, db: Tx) {
    if (kind === 'zone') {
      const zone = await this.loadZone(actor, id, db);
      return {
        code: zone.code,
        isStaging: zone.isStaging,
        isActive: zone.isActive,
        parentActive: true,
        subtree: { zoneId: id } as Subtree,
      };
    }
    if (kind === 'container') {
      const container = await this.loadContainer(actor, id, db);
      return {
        code: `${container.zone.code}-${container.code}`,
        isStaging: container.zone.isStaging,
        isActive: container.isActive,
        parentActive: container.zone.isActive,
        subtree: { containerId: id } as Subtree,
      };
    }
    const rack = await this.loadRack(actor, id, db);
    return {
      code: rack.locationCode,
      isStaging: rack.container.zone.isStaging,
      isActive: rack.isActive,
      parentActive: rack.container.isActive && rack.container.zone.isActive,
      subtree: { rackId: id } as Subtree,
    };
  }

  // ─── Crear ─────────────────────────────────────────────────────────────────

  async createZone(
    actor: WarehouseActor,
    warehouseId: string,
    input: ZoneCreateInput,
  ): Promise<ZoneDto> {
    await this.loadWarehouse(actor, warehouseId);
    const used = await repo.zoneCodes(this.prisma, warehouseId);
    const code = input.code ?? nextZoneCode(used);
    if (used.includes(code)) throw duplicate('zone');
    const zone = await this.prisma.zone
      .create({ data: { ...input, code, warehouseId } })
      .catch(this.onUnique('zone'));
    return toZoneDto(zone);
  }

  async createContainer(
    actor: WarehouseActor,
    zoneId: string,
    input: ContainerCreateInput,
  ): Promise<ContainerDto> {
    const zone = await this.writableZone(actor, zoneId);
    const used = await repo.containerCodes(this.prisma, zoneId);
    const code = input.code ?? nextSegmentCodes(used, 1)[0]!;
    if (used.includes(code)) throw duplicate('container');
    const container = await this.prisma.container
      .create({ data: { zoneId: zone.id, code, name: input.name } })
      .catch(this.onUnique('container'));
    return toContainerDto(container);
  }

  async createContainersBatch(
    actor: WarehouseActor,
    zoneId: string,
    input: ContainerBatchInput,
  ): Promise<ContainerDto[]> {
    const zone = await this.writableZone(actor, zoneId);
    const rows = await this.prisma.$transaction(
      async (tx) => {
        const codes = nextSegmentCodes(await repo.containerCodes(tx, zoneId), input.count);
        const created: Container[] = [];
        for (const code of codes) {
          const container = await tx.container.create({ data: { zoneId, code } });
          if (input.racksPerContainer) {
            await this.insertRacks(tx, zone, container, {
              codes: nextSegmentCodes([], input.racksPerContainer),
              capacityUnits: input.capacityUnits!,
              labelColor: input.labelColor,
            });
          }
          created.push(container);
        }
        return created;
      },
      { timeout: BATCH_TIMEOUT_MS },
    );
    return rows.map(toContainerDto);
  }

  async createRack(
    actor: WarehouseActor,
    containerId: string,
    input: RackCreateInput,
  ): Promise<RackDto> {
    const container = await this.writableContainer(actor, containerId);
    const used = await repo.rackCodes(this.prisma, containerId);
    const code = input.code ?? nextSegmentCodes(used, 1)[0]!;
    if (used.includes(code)) throw duplicate('rack');
    const [rack] = await this.insertRacks(this.prisma, container.zone, container, {
      codes: [code],
      capacityUnits: input.capacityUnits,
      labelColor: input.labelColor,
    }).catch(this.onUnique('rack'));
    return toRackDto(rack!);
  }

  async createRacksBatch(
    actor: WarehouseActor,
    containerId: string,
    input: RackBatchInput,
  ): Promise<RackDto[]> {
    const container = await this.writableContainer(actor, containerId);
    const racks = await this.prisma.$transaction(
      async (tx) =>
        this.insertRacks(tx, container.zone, container, {
          codes: nextSegmentCodes(await repo.rackCodes(tx, containerId), input.count),
          capacityUnits: input.capacityUnits,
          labelColor: input.labelColor,
        }),
      { timeout: BATCH_TIMEOUT_MS },
    );
    return racks.map(toRackDto);
  }

  private async insertRacks(
    db: Tx,
    zone: Pick<Zone, 'code' | 'warehouseId'>,
    container: Pick<Container, 'id' | 'code'>,
    data: { codes: string[]; capacityUnits: number; labelColor: string | null },
  ): Promise<Rack[]> {
    const racks = await db.rack.createManyAndReturn({
      data: data.codes.map((code) => ({
        containerId: container.id,
        warehouseId: zone.warehouseId,
        code,
        locationCode: buildLocationCode({ zone: zone.code, container: container.code, rack: code }),
        capacityUnits: data.capacityUnits,
        labelColor: data.labelColor,
      })),
    });
    return racks.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Zona donde se puede agregar estructura: no staging y activa. */
  private async writableZone(actor: WarehouseActor, zoneId: string) {
    const zone = await this.loadZone(actor, zoneId);
    if (zone.isStaging) throw locked();
    if (!zone.isActive) throw inactiveParent('zone');
    return zone;
  }

  private async writableContainer(actor: WarehouseActor, containerId: string) {
    const container = await this.loadContainer(actor, containerId);
    if (container.zone.isStaging) throw locked();
    if (!container.isActive) throw inactiveParent('container');
    if (!container.zone.isActive) throw inactiveParent('zone');
    return container;
  }

  // ─── Editar ────────────────────────────────────────────────────────────────

  async updateZone(
    actor: WarehouseActor,
    id: string,
    input: ZoneUpdateInput,
  ): Promise<ZoneChangeDto> {
    const zone = await this.loadZone(actor, id);
    if (zone.isStaging) throw locked();
    const codeChanged = input.code !== undefined && input.code !== zone.code;
    if (
      codeChanged &&
      (await repo.zoneCodes(this.prisma, zone.warehouseId)).includes(input.code!)
    ) {
      throw duplicate('zone');
    }
    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.zone.update({ where: { id }, data: input });
        const affectedRacks = codeChanged
          ? await this.recompute(tx, actor, 'zone', id, { zoneId: id }, zone.code, input.code!)
          : 0;
        return { ...toZoneDto(updated), affectedRacks, overCapacity: false };
      })
      .catch(this.onUnique('zone'));
  }

  async updateContainer(
    actor: WarehouseActor,
    id: string,
    input: ContainerUpdateInput,
  ): Promise<ContainerChangeDto> {
    const container = await this.loadContainer(actor, id);
    if (container.zone.isStaging) throw locked();
    const codeChanged = input.code !== undefined && input.code !== container.code;
    if (
      codeChanged &&
      (await repo.containerCodes(this.prisma, container.zoneId)).includes(input.code!)
    ) {
      throw duplicate('container');
    }
    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.container.update({ where: { id }, data: input });
        const affectedRacks = codeChanged
          ? await this.recompute(
              tx,
              actor,
              'container',
              id,
              { containerId: id },
              `${container.zone.code}-${container.code}`,
              `${container.zone.code}-${input.code}`,
            )
          : 0;
        return { ...toContainerDto(updated), affectedRacks, overCapacity: false };
      })
      .catch(this.onUnique('container'));
  }

  async updateRack(
    actor: WarehouseActor,
    id: string,
    input: RackUpdateInput,
  ): Promise<RackChangeDto> {
    const rack = await this.loadRack(actor, id);
    if (rack.container.zone.isStaging) throw locked();
    const codeChanged = input.code !== undefined && input.code !== rack.code;
    if (
      codeChanged &&
      (await repo.rackCodes(this.prisma, rack.containerId)).includes(input.code!)
    ) {
      throw duplicate('rack');
    }
    return this.prisma
      .$transaction(async (tx) => {
        let updated = await tx.rack.update({ where: { id }, data: input });
        let affectedRacks = 0;
        if (codeChanged) {
          const newCode = buildLocationCode({
            zone: rack.container.zone.code,
            container: rack.container.code,
            rack: input.code!,
          });
          affectedRacks = await this.recompute(
            tx,
            actor,
            'rack',
            id,
            { rackId: id },
            rack.locationCode,
            newCode,
          );
          updated = await tx.rack.findUniqueOrThrow({ where: { id } });
        }
        const occupied = await repo.occupiedUnits(tx, id);
        return {
          ...toRackDto(updated),
          affectedRacks,
          overCapacity: occupied > updated.capacityUnits,
        };
      })
      .catch(this.onUnique('rack'));
  }

  /** Recalcula los `locationCode` del subárbol y deja el cambio en el audit. */
  private async recompute(
    tx: Tx,
    actor: WarehouseActor,
    kind: StructureKind,
    id: string,
    subtree: Subtree,
    from: string,
    to: string,
  ): Promise<number> {
    const before = await repo.racksOf(tx, subtree);
    const after = new Map(
      (
        await repo.recomputeLocationCodes(
          tx,
          before.map((r) => r.id),
        )
      ).map((r) => [r.id, r.locationCode]),
    );
    const locationCodes = before.map((r) => ({ from: r.locationCode, to: after.get(r.id)! }));
    await this.app.audit.record(
      {
        userId: actor.userId,
        action: 'warehouse.code_change',
        entity: ENTITY[kind],
        entityId: id,
        payload: { from, to, locationCodes },
        ip: actor.ip,
      },
      tx,
    );
    return locationCodes.filter((c) => c.from !== c.to).length;
  }

  // ─── Activar, desactivar y borrar ──────────────────────────────────────────

  /** Desactiva el nodo y su subárbol si ningún rack tiene stock (spec F7 §3). */
  async deactivate(actor: WarehouseActor, kind: StructureKind, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const node = await this.loadNode(actor, kind, id, tx);
      if (node.isStaging) throw locked();
      const racks = await repo.racksOf(tx, node.subtree);
      const ids = racks.map((r) => r.id);
      await repo.lockRacks(tx, ids);
      const stocked = await repo.stockedLocationCodes(tx, ids);
      if (stocked.length > 0) {
        throw new DomainError('RACK_HAS_STOCK', { details: { locationCodes: stocked } });
      }
      await tx.rack.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
      if (kind !== 'rack') {
        await tx.container.updateMany({
          where: kind === 'zone' ? { zoneId: id } : { id },
          data: { isActive: false },
        });
      }
      if (kind === 'zone') await tx.zone.update({ where: { id }, data: { isActive: false } });
      if (node.isActive) {
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'warehouse.deactivate',
            entity: ENTITY[kind],
            entityId: id,
            payload: { code: node.code, racks: racks.map((r) => r.locationCode) },
            ip: actor.ip,
          },
          tx,
        );
      }
      return this.dtoOf(tx, kind, id);
    });
  }

  /** Reactiva solo ese nivel; el padre debe estar activo. */
  async reactivate(actor: WarehouseActor, kind: StructureKind, id: string) {
    const node = await this.loadNode(actor, kind, id, this.prisma);
    if (node.isStaging) throw locked();
    if (!node.parentActive) throw inactiveParent(kind === 'rack' ? 'container' : 'zone');
    const data = { isActive: true };
    if (kind === 'zone') await this.prisma.zone.update({ where: { id }, data });
    else if (kind === 'container') await this.prisma.container.update({ where: { id }, data });
    else await this.prisma.rack.update({ where: { id }, data });
    return this.dtoOf(this.prisma, kind, id);
  }

  /** Borra el nodo y su subárbol si ningún rack tiene historial; si no, hay que desactivarlo. */
  async delete(actor: WarehouseActor, kind: StructureKind, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const node = await this.loadNode(actor, kind, id, tx);
      if (node.isStaging) throw locked();
      const racks = await repo.racksOf(tx, node.subtree);
      const ids = racks.map((r) => r.id);
      await repo.lockRacks(tx, ids);
      if (await repo.anyRackHasHistory(tx, ids)) throw new DomainError('STRUCTURE_HAS_HISTORY');
      await tx.rack.deleteMany({ where: { id: { in: ids } } });
      if (kind !== 'rack') {
        await tx.container.deleteMany({ where: kind === 'zone' ? { zoneId: id } : { id } });
      }
      if (kind === 'zone') await tx.zone.delete({ where: { id } });
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'warehouse.delete',
          entity: ENTITY[kind],
          entityId: id,
          payload: { code: node.code, racks: racks.map((r) => r.locationCode) },
          ip: actor.ip,
        },
        tx,
      );
    });
  }

  private async dtoOf(db: Tx, kind: StructureKind, id: string) {
    if (kind === 'zone') return toZoneDto(await db.zone.findUniqueOrThrow({ where: { id } }));
    if (kind === 'container') {
      return toContainerDto(await db.container.findUniqueOrThrow({ where: { id } }));
    }
    return toRackDto(await db.rack.findUniqueOrThrow({ where: { id } }));
  }

  /** Un código repetido por una escritura concurrente también responde 409 `CONFLICT`. */
  private onUnique(kind: StructureKind) {
    return (error: unknown): never => {
      throw isUniqueViolation(error) ? duplicate(kind) : error;
    };
  }
}
