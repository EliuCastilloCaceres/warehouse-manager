import { randomUUID } from 'node:crypto';
import { ImageUploadDto, type PermissionCode } from '@warehouse-manager/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { validationError } from '../../core/errors.js';
import { processImage } from './image.processor.js';

type Entity = 'product' | 'branch';

export const uploadsRoutes: FastifyPluginAsyncZod = async (app) => {
  const upload = (entity: Entity) => async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await request.file();
    if (!file || file.fieldname !== 'file') throw validationError('file', 'Falta el archivo');
    const buffer = await file.toBuffer(); // > 10 MiB → 413 PAYLOAD_TOO_LARGE
    const image = await processImage(buffer);

    const id = randomUUID();
    const mainKey = `${entity}/${id}.webp`;
    const main = await app.storage.save(mainKey, image.main, 'image/webp');
    let thumb: { url: string };
    try {
      thumb = await app.storage.save(`${entity}/${id}.thumb.webp`, image.thumb, 'image/webp');
    } catch (error) {
      await app.storage.delete(mainKey);
      throw error;
    }
    return reply.status(201).send({
      url: main.url,
      thumbUrl: thumb.url,
      width: image.width,
      height: image.height,
    });
  };

  const route = (path: string, entity: Entity, permission: PermissionCode, summary: string) =>
    app.post(
      path,
      {
        config: { access: { permission } },
        schema: {
          tags: ['uploads'],
          summary,
          consumes: ['multipart/form-data'],
          response: { 201: ImageUploadDto },
        },
      },
      upload(entity),
    );

  route('/product-images', 'product', 'products.manage', 'Subir una imagen de producto');
  route('/branch-images', 'branch', 'settings.branch', 'Subir una imagen de la sucursal');
};
