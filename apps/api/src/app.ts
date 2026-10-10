import { mkdirSync } from 'node:fs';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { IMAGE_UPLOAD_MAX_BYTES } from '@warehouse-manager/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditService } from './core/audit/audit.service.js';
import type { AppConfig } from './core/config.js';
import { resolveUploadsDir } from './core/paths.js';
import { accessPlugin } from './core/plugins/access.js';
import { authPlugin } from './core/plugins/auth.js';
import { branchContextPlugin } from './core/plugins/branchContext.js';
import { errorHandlerPlugin } from './core/plugins/errorHandler.js';
import { prismaPlugin } from './core/plugins/prisma.js';
import {
  genReqId,
  loggerOptions,
  requestContextPlugin,
  type LoggerOption,
} from './core/plugins/requestContext.js';
import { securityPlugin } from './core/plugins/security.js';
import { createPrismaClient, type PrismaClient } from './core/prisma-client.js';
import { LocalStorageService } from './core/storage/local-storage.service.js';
import type { StorageService } from './core/storage/storage.service.js';
import { registerSwagger } from './core/swagger.js';
import './core/types.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { uploadsRoutes } from './modules/uploads/uploads.routes.js';

export interface AppDeps {
  prisma?: PrismaClient;
  storage?: StorageService;
  /** `false` desactiva los logs (tests); un objeto se combina con las opciones por defecto. */
  logger?: LoggerOption;
  /** Solo para tests: registra rutas extra bajo /api/v1 (acceso, sucursal, errores). */
  registerExtra?: (api: FastifyInstance) => Promise<void> | void;
}

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config, deps.logger),
    genReqId,
    requestIdHeader: false,
    trustProxy: config.TRUST_PROXY,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);

  await app.register(requestContextPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin, {
    prisma: deps.prisma ?? createPrismaClient(config.DATABASE_URL),
    owned: !deps.prisma,
  });
  await app.register(securityPlugin);
  await app.register(authPlugin, {
    secret: config.JWT_SECRET,
    accessTtlMin: config.ACCESS_TTL_MIN,
  });
  // Antes de Swagger y de las rutas: su onRoute exige config.access y marca la seguridad Bearer.
  await app.register(accessPlugin);
  await app.register(branchContextPlugin);
  await app.register(multipart, { limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1 } });

  const uploadsDir = resolveUploadsDir(config.UPLOADS_DIR);
  app.decorate('storage', deps.storage ?? new LocalStorageService(uploadsDir));
  app.decorate('audit', new AuditService(app.prisma));
  app.decorate('authService', new AuthService(app));

  if (config.NODE_ENV !== 'production') {
    // En producción /uploads lo sirve Nginx (F10).
    mkdirSync(uploadsDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
      decorateReply: false,
    });
    await registerSwagger(app, config.APP_VERSION);
  }

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(uploadsRoutes, { prefix: '/uploads' });
      await deps.registerExtra?.(api);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
