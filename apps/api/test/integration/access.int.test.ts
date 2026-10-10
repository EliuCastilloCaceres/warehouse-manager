import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { registerTestRoutes } from './helpers/testRoutes.js';
import { createUser } from './helpers/users.js';

describe('control de acceso por ruta (T19)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let sellerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'vendedor', role: 'SELLER' });
    await createUser(prisma, { username: 'gerente', role: 'MANAGER' });
    app = await createTestApp(prisma, { registerExtra: registerTestRoutes });
    sellerToken = (await login(app, 'vendedor')).accessToken;
    managerToken = (await login(app, 'gerente')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  it('sin token → 401 UNAUTHENTICATED', async () => {
    const res = await get('/api/v1/test/protected');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('firma inválida → 401', async () => {
    const forged = await buildForgedToken(managerToken);
    const res = await get('/api/v1/test/protected', bearer(forged));
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('token sin el permiso → 403 FORBIDDEN con details.permission', async () => {
    const res = await get('/api/v1/test/protected', bearer(sellerToken));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'products.manage' },
    });
  });

  it('con el permiso → 200', async () => {
    const res = await get('/api/v1/test/protected', bearer(managerToken));
    expect(res.statusCode).toBe(200);
  });

  it('ruta authenticated con cualquier token válido → 200; pública sin token → 200', async () => {
    expect((await get('/api/v1/test/authenticated', bearer(sellerToken))).statusCode).toBe(200);
    expect((await get('/api/v1/test/public')).statusCode).toBe(200);
  });
});

/** Mismo payload, firma de otra clave. */
async function buildForgedToken(validToken: string): Promise<string> {
  const [header, payload] = validToken.split('.');
  return `${header}.${payload}.${Buffer.from('firma-falsa').toString('base64url')}`;
}
