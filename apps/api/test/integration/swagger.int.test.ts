import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createTestClient } from './helpers/db.js';

interface OpenApiOperation {
  tags?: string[];
  security?: unknown[];
}

describe('Swagger (T41)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let doc: {
    components: { securitySchemes: Record<string, unknown> };
    paths: Record<string, Record<string, OpenApiOperation>>;
  };

  beforeAll(async () => {
    prisma = createTestClient();
    app = await createTestApp(prisma);
    doc = (await app.inject({ method: 'GET', url: '/api/docs/json' })).json();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const operations = () =>
    Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ path, method, op })),
    );

  it('declara el esquema bearerAuth', () => {
    expect(doc.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('las rutas de auth tienen el tag auth', () => {
    const auth = operations().filter((o) => o.path.startsWith('/api/v1/auth/'));
    expect(auth.map((o) => `${o.method} ${o.path}`).sort()).toEqual([
      'get /api/v1/auth/me',
      'post /api/v1/auth/change-password',
      'post /api/v1/auth/login',
      'post /api/v1/auth/logout',
      'post /api/v1/auth/refresh',
    ]);
    for (const { op } of auth) expect(op.tags).toContain('auth');
  });

  it('las rutas no públicas llevan security y health no', () => {
    const PUBLIC = [
      '/api/v1/health',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
    ];
    for (const { path, op } of operations()) {
      if (PUBLIC.includes(path)) {
        expect(op.security).toBeUndefined();
      } else {
        expect(op.security).toEqual([{ bearerAuth: [] }]);
      }
    }
    expect(doc.paths['/api/v1/uploads/product-images']?.post?.security).toEqual([
      { bearerAuth: [] },
    ]);
  });
});
