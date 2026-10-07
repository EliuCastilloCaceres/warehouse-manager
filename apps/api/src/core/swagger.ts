import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** Registra el documento OpenAPI y Swagger UI en /api/docs. */
export async function registerSwagger(app: FastifyInstance, version: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: { title: 'warehouse-manager API', version },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
}
