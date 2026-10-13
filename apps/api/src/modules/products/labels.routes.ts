import { LabelDataDto, LabelRequest } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ProductsService } from './products.service.js';

/** `POST /products/labels`: datos para dibujar etiquetas; el dibujo es del cliente. */
export const productLabelsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ProductsService(app);

  app.post(
    '/labels',
    {
      config: { access: { permission: 'products.labels' } },
      schema: {
        tags: ['products'],
        summary: 'Datos de etiquetas por variante y cantidad',
        body: LabelRequest,
        response: { 200: z.array(LabelDataDto) },
      },
    },
    async (request) => service.labels(request.body),
  );
};
