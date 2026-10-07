import { HealthDto } from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../core/config.js';

describe('health', () => {
  const config = loadConfig({ NODE_ENV: 'test', APP_VERSION: '9.8.7' });
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(config, { logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde un HealthDto válido (T5)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = HealthDto.parse(res.json());
    expect(body.version).toBe(config.APP_VERSION);
  });

  it('GET /api/docs/json documenta GET /api/v1/health (T6)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });

    expect(res.statusCode).toBe(200);
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths['/api/v1/health']).toHaveProperty('get');
  });
});
