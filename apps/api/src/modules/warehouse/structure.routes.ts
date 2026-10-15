import {
  ContainerBatchInput,
  ContentQuery,
  ContainerChangeDto,
  ContainerCreateInput,
  ContainerDto,
  ContainerUpdateInput,
  RackBatchInput,
  RackChangeDto,
  RackCreateInput,
  RackDto,
  RackUpdateInput,
  NodeContentDto,
  Uuid,
  WarehouseDto,
  WarehouseTreeDto,
  WarehouseTreeQuery,
  ZoneChangeDto,
  ZoneCreateInput,
  ZoneDto,
  ZoneUpdateInput,
} from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type StructureKind, StructureService, type WarehouseActor } from './structure.service.js';
import { TreeService } from './tree.service.js';

const IdParams = z.object({ id: Uuid });
const READ = { access: { permission: 'warehouse.read' } } as const;
const MANAGE = { access: { permission: 'warehouse.manage' } } as const;

export function warehouseActorOf(request: FastifyRequest): WarehouseActor {
  return { userId: request.auth!.userId, branchIds: request.auth!.branchIds, ip: request.ip };
}

const KINDS = [
  { kind: 'zone', path: '/zones', label: 'una zona', dto: ZoneDto },
  { kind: 'container', path: '/containers', label: 'un contenedor', dto: ContainerDto },
  { kind: 'rack', path: '/racks', label: 'un rack', dto: RackDto },
] as const satisfies readonly { kind: StructureKind; path: string; label: string; dto: unknown }[];

/** Estructura del almacén: zonas, contenedores y racks (spec F7 §6). */
export const structureRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new StructureService(app);
  const tree = new TreeService(app);
  const tags = ['warehouse'];

  app.get(
    '/warehouses',
    {
      config: { ...READ, branchScoped: true },
      schema: {
        tags,
        summary: 'Almacenes de la sucursal actual',
        response: { 200: z.array(WarehouseDto) },
      },
    },
    async (request) => service.listWarehouses(request.branchId!),
  );

  app.get(
    '/warehouses/:id/tree',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Mapa del almacén: ocupación por zona, contenedor y rack',
        params: IdParams,
        querystring: WarehouseTreeQuery,
        response: { 200: WarehouseTreeDto },
      },
    },
    async (request) => tree.tree(warehouseActorOf(request), request.params.id, request.query),
  );

  app.post(
    '/warehouses/:id/zones',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear una zona',
        params: IdParams,
        body: ZoneCreateInput,
        response: { 201: ZoneDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await service.createZone(warehouseActorOf(request), request.params.id, request.body)),
  );

  app.patch(
    '/zones/:id',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Editar una zona (un cambio de código recalcula sus ubicaciones)',
        params: IdParams,
        body: ZoneUpdateInput,
        response: { 200: ZoneChangeDto },
      },
    },
    async (request) =>
      service.updateZone(warehouseActorOf(request), request.params.id, request.body),
  );

  app.post(
    '/zones/:id/containers',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear un contenedor',
        params: IdParams,
        body: ContainerCreateInput,
        response: { 201: ContainerDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await service.createContainer(warehouseActorOf(request), request.params.id, request.body),
        ),
  );

  app.post(
    '/zones/:id/containers/batch',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear varios contenedores (y sus racks)',
        params: IdParams,
        body: ContainerBatchInput,
        response: { 201: z.array(ContainerDto) },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await service.createContainersBatch(
            warehouseActorOf(request),
            request.params.id,
            request.body,
          ),
        ),
  );

  app.patch(
    '/containers/:id',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Editar un contenedor (un cambio de código recalcula sus ubicaciones)',
        params: IdParams,
        body: ContainerUpdateInput,
        response: { 200: ContainerChangeDto },
      },
    },
    async (request) =>
      service.updateContainer(warehouseActorOf(request), request.params.id, request.body),
  );

  app.post(
    '/containers/:id/racks',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear un rack',
        params: IdParams,
        body: RackCreateInput,
        response: { 201: RackDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await service.createRack(warehouseActorOf(request), request.params.id, request.body)),
  );

  app.post(
    '/containers/:id/racks/batch',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear varios racks',
        params: IdParams,
        body: RackBatchInput,
        response: { 201: z.array(RackDto) },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await service.createRacksBatch(
            warehouseActorOf(request),
            request.params.id,
            request.body,
          ),
        ),
  );

  app.patch(
    '/racks/:id',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Editar un rack (código, capacidad o color)',
        params: IdParams,
        body: RackUpdateInput,
        response: { 200: RackChangeDto },
      },
    },
    async (request) =>
      service.updateRack(warehouseActorOf(request), request.params.id, request.body),
  );

  for (const { kind, path, label, dto } of KINDS) {
    app.get(
      `${path}/:id`,
      {
        config: READ,
        schema: {
          tags,
          summary: `Contenido de ${label}, por variante`,
          params: IdParams,
          querystring: ContentQuery,
          response: { 200: NodeContentDto },
        },
      },
      async (request) =>
        tree.content(warehouseActorOf(request), kind, request.params.id, request.query),
    );

    app.post(
      `${path}/:id/deactivate`,
      {
        config: MANAGE,
        schema: {
          tags,
          summary: `Desactivar ${label} (y lo que contiene)`,
          params: IdParams,
          response: { 200: dto },
        },
      },
      async (request) => service.deactivate(warehouseActorOf(request), kind, request.params.id),
    );

    app.post(
      `${path}/:id/reactivate`,
      {
        config: MANAGE,
        schema: {
          tags,
          summary: `Reactivar ${label}`,
          params: IdParams,
          response: { 200: dto },
        },
      },
      async (request) => service.reactivate(warehouseActorOf(request), kind, request.params.id),
    );

    app.delete(
      `${path}/:id`,
      {
        config: MANAGE,
        schema: {
          tags,
          summary: `Eliminar ${label} sin historial`,
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await service.delete(warehouseActorOf(request), kind, request.params.id);
        return reply.status(204).send(null);
      },
    );
  }
};
