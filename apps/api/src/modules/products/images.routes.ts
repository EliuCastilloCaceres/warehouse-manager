import {
  ProductImageAddInput,
  ProductImageAssignInput,
  ProductImageDto,
  ProductImageOrderInput,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ProductsService } from './products.service.js';

const IdParams = z.object({ id: Uuid });
const ImageParams = IdParams.extend({ imageId: Uuid });
const MANAGE = { access: { permission: 'products.manage' } } as const;

/** `/products/:id/images`: galería del producto (spec F6 §3). */
export const productImagesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ProductsService(app);
  const tags = ['products'];

  app.post(
    '/:id/images',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Agregar una imagen subida con /uploads/product-images',
        params: IdParams,
        body: ProductImageAddInput,
        response: { 201: ProductImageDto },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.addImage(request.params.id, request.body)),
  );

  app.put(
    '/:id/images/order',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Ordenar las imágenes (la primera es la principal)',
        params: IdParams,
        body: ProductImageOrderInput,
        response: { 200: z.array(ProductImageDto) },
      },
    },
    async (request) => service.orderImages(request.params.id, request.body.imageIds),
  );

  app.patch(
    '/:id/images/:imageId',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Asignar una imagen a una variante (o a todo el producto)',
        params: ImageParams,
        body: ProductImageAssignInput,
        response: { 200: ProductImageDto },
      },
    },
    async (request) =>
      service.assignImage(request.params.id, request.params.imageId, request.body.variantId),
  );

  app.delete(
    '/:id/images/:imageId',
    {
      config: MANAGE,
      schema: {
        tags,
        summary: 'Quitar una imagen (el archivo se conserva)',
        params: ImageParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.deleteImage(request.params.id, request.params.imageId);
      return reply.status(204).send(null);
    },
  );
};
