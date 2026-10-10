import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { bearer, login, withRefreshCookie } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import { registerTestRoutes } from './helpers/testRoutes.js';
import { createUser } from './helpers/users.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('contexto de petición y logs (T26)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  const lines: Record<string, unknown>[] = [];

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    await createUser(prisma, { username: 'logs' });
    app = await createTestApp(prisma, {
      registerExtra: registerTestRoutes,
      logger: {
        level: 'info',
        stream: { write: (line: string) => void lines.push(JSON.parse(line)) },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('respeta un x-request-id UUID y genera uno si el entrante no es válido', async () => {
    const id = '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c';
    const kept = await app.inject({
      method: 'GET',
      url: '/api/v1/test/public',
      headers: { 'x-request-id': id },
    });
    expect(kept.headers['x-request-id']).toBe(id);

    const generated = await app.inject({
      method: 'GET',
      url: '/api/v1/test/public',
      headers: { 'x-request-id': 'no-es-uuid' },
    });
    expect(generated.headers['x-request-id']).toMatch(UUID);
    expect(generated.headers['x-request-id']).not.toBe('no-es-uuid');
  });

  it('el log de una petición autenticada lleva userId y oculta authorization y cookie', async () => {
    const { accessToken, session } = await login(app, 'logs');
    lines.length = 0;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/test/authenticated',
      headers: { ...bearer(accessToken), ...withRefreshCookie('secreto-de-cookie') },
    });
    const reqId = res.headers['x-request-id'];
    const own = lines.filter((line) => line.reqId === reqId);

    expect(own.some((line) => line.userId === session.me.user.id)).toBe(true);
    const incoming = own.find((line) => line.msg === 'incoming request') as {
      req: { headers: Record<string, string> };
    };
    expect(incoming.req.headers.authorization).toBe('[oculto]');
    expect(incoming.req.headers.cookie).toBe('[oculto]');
    expect(JSON.stringify(own)).not.toContain(accessToken);
    expect(JSON.stringify(own)).not.toContain('secreto-de-cookie');
  });
});
