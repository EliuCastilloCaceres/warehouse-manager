import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * Documento OpenAPI y Swagger UI en /api/docs. Las rutas no públicas reciben
 * `security: [{ bearerAuth: [] }]` desde el plugin `access`.
 */
export async function registerSwagger(app: FastifyInstance, version: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: { title: 'warehouse-manager API', version },
      tags: [
        { name: 'system', description: 'Estado del sistema' },
        { name: 'auth', description: 'Autenticación y sesión' },
        { name: 'uploads', description: 'Subida de imágenes' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
}
