import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError } from '../../../src/core/errors.js';

/** Rutas de prueba (acceso, sucursal y errores); se registran con `registerExtra`. */
export function registerTestRoutes(api: FastifyInstance): void {
  const app = api.withTypeProvider<ZodTypeProvider>();

  app.get('/test/public', { config: { access: 'public' } }, async () => ({ ok: true }));

  app.get('/test/authenticated', { config: { access: 'authenticated' } }, async (request) => ({
    userId: request.auth!.userId,
  }));

  app.get(
    '/test/protected',
    { config: { access: { permission: 'products.manage' } } },
    async () => ({ ok: true }),
  );

  app.get(
    '/test/branch',
    { config: { access: 'authenticated', branchScoped: true } },
    async (request) => ({ branchId: request.branchId }),
  );

  app.post(
    '/test/validate',
    {
      config: { access: 'public' },
      schema: { body: z.object({ name: z.string().min(2), qty: z.number().int() }) },
    },
    async (request) => request.body,
  );

  app.get('/test/domain-error', { config: { access: 'public' } }, async () => {
    throw new DomainError('STOCK_INSUFFICIENT', { details: { available: 1, requested: 2 } });
  });

  app.post('/test/unique', { config: { access: 'public' } }, async () => {
    await api.prisma.brand.create({ data: { name: 'Marca duplicada' } });
    await api.prisma.brand.create({ data: { name: 'Marca duplicada' } });
    return { ok: true };
  });

  app.post('/test/check-raw', { config: { access: 'public' } }, async () => {
    await api.prisma.$executeRawUnsafe(
      "INSERT INTO branch (code, name, tax_rate_bp, updated_at) VALUES ('ZZ', 'x', 99999, now())",
    );
    return { ok: true };
  });

  app.get('/test/boom', { config: { access: 'public' } }, async () => {
    throw new Error('x detalle-interno-secreto');
  });
}
