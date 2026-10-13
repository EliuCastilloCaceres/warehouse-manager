import {
  LookupResultDto,
  paginated,
  ProductCatalogsDto,
  ProductDetailDto,
  ProductListItemDto,
  ProductListQuery,
  ProductUpsertInput,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type ProductActor, ProductsService } from './products.service.js';

const IdParams = z.object({ id: Uuid });
const VariantParams = IdParams.extend({ variantId: Uuid });
const READ = { access: { permission: 'products.read' }, branchScoped: true } as const;
// Las respuestas con `ProductDetailDto` llevan el stock de la sucursal actual.
const MANAGE = { access: { permission: 'products.manage' }, branchScoped: true } as const;

export function productActorOf(request: FastifyRequest): ProductActor {
  return { userId: request.auth!.userId, ip: request.ip };
}

/** `/products`: catálogo, variantes, activación, borrado y lookup (spec F6 §6). */
export const productsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ProductsService(app);
  const tags = ['products'];

  app.get(
    '/',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Listar productos',
        querystring: ProductListQuery,
        response: { 200: paginated(ProductListItemDto) },
      },
    },
    async (request) => service.list(request.query, request.branchId!),
  );

  app.get(
    '/catalogs',
    {
      config: { access: { permission: 'products.read' } },
      schema: {
        tags,
        summary: 'Categorías y marcas para autocompletar',
        response: { 200: ProductCatalogsDto },
      },
    },
    async () => service.catalogs(),
  );

  app.get(
    '/lookup',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Buscar por SKU de variante, código de barras o SKU padre',
        querystring: z.object({ code: z.string().trim().min(1).max(60) }),
        response: { 200: LookupResultDto },
      },
    },
    async (request) => service.lookup(request.query.code, request.branchId!),
  );

  app.get(
    '/:id',
    {
      config: READ,
      schema: {
        tags,
        summary: 'Detalle de un producto',
        params: IdParams,
        response: { 200: ProductDetailDto },
      },
    },
    async (request) => service.get(request.params.id, request.branchId!),
  );

  app.post(
    '/',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Crear un producto',
        body: ProductUpsertInput,
        response: { 201: ProductDetailDto },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(request.body, request.branchId!)),
  );

  app.put(
    '/:id',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Editar un producto (reemplaza sus variantes)',
        params: IdParams,
        body: ProductUpsertInput,
        response: { 200: ProductDetailDto },
      },
    },
    async (request) => service.update(request.params.id, request.body, request.branchId!),
  );

  for (const [action, isActive] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    app.post(
      `/:id/${action}`,
      {
        config: MANAGE,
        schema: {
          tags,
          summary: isActive ? 'Reactivar un producto' : 'Desactivar un producto',
          params: IdParams,
          response: { 200: ProductDetailDto },
        },
      },
      async (request) => service.setActive(request.params.id, isActive, request.branchId!),
    );

    app.post(
      `/:id/variants/:variantId/${action}`,
      {
        config: MANAGE,
        schema: {
          tags,
          summary: isActive ? 'Reactivar una variante' : 'Desactivar una variante',
          params: VariantParams,
          response: { 200: ProductDetailDto },
        },
      },
      async (request) =>
        service.setVariantActive(
          request.params.id,
          request.params.variantId,
          isActive,
          request.branchId!,
        ),
    );
  }

  app.delete(
    '/:id',
    {
      config: { access: { permission: 'products.manage' } },
      schema: {
        tags,
        summary: 'Eliminar un producto sin historial',
        params: IdParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id, productActorOf(request));
      return reply.status(204).send(null);
    },
  );
};
