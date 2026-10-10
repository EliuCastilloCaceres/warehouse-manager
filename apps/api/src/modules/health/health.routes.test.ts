import { ApiErrorDto, HealthDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { fakePrisma, testConfig } from '../../../test/helpers/config.js';
import { buildApp } from '../../app.js';

describe('health', () => {
  const config = testConfig();
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(config, { prisma: fakePrisma(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde un HealthDto válido (T5 de F0)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = HealthDto.parse(res.json());
    expect(body.version).toBe(config.APP_VERSION);
    expect(body.database).toBe('ok');
  });

  it('GET /api/docs/json documenta GET /api/v1/health (T6 de F0)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });

    expect(res.statusCode).toBe(200);
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths['/api/v1/health']).toHaveProperty('get');
  });

  it('con la BD caída responde 503 DB_UNAVAILABLE (T10, unitario)', async () => {
    const down = await buildApp(config, {
      prisma: fakePrisma({ $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
      logger: false,
    });
    try {
      const res = await down.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(ApiErrorDto.parse(res.json()).code).toBe('DB_UNAVAILABLE');
    } finally {
      await down.close();
    }
  });
});
