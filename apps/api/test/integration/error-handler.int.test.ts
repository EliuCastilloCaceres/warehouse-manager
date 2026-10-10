import { ApiErrorDto } from '@warehouse-manager/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createTestClient, truncateAll } from './helpers/db.js';
import { registerTestRoutes } from './helpers/testRoutes.js';

describe('formato estándar de errores (T11)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = createTestClient();
    await truncateAll(prisma);
    app = await createTestApp(prisma, { registerExtra: registerTestRoutes });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const json = (body: unknown) => ({
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

  interface Case {
    name: string;
    request: InjectOptions;
    status: number;
    code: string;
    check?: (body: ApiErrorDto, raw: string) => void;
  }

  it.each<Case>([
    {
      name: 'body inválido → 400 VALIDATION_ERROR con details[].path',
      request: { method: 'POST', url: '/api/v1/test/validate', ...json({ name: 'x', qty: 1.5 }) },
      status: 400,
      code: 'VALIDATION_ERROR',
      check: (body: ApiErrorDto) =>
        expect((body.details as { path: string }[]).map((d) => d.path).sort()).toEqual([
          'name',
          'qty',
        ]),
    },
    {
      name: 'JSON mal formado → 400',
      request: {
        method: 'POST',
        url: '/api/v1/test/validate',
        payload: '{"name": ',
        headers: { 'content-type': 'application/json' },
      },
      status: 400,
      code: 'VALIDATION_ERROR',
    },
    {
      name: 'DomainError(STOCK_INSUFFICIENT) → 409',
      request: { method: 'GET', url: '/api/v1/test/domain-error' },
      status: 409,
      code: 'STOCK_INSUFFICIENT',
      check: (body: ApiErrorDto) => expect(body.details).toEqual({ available: 1, requested: 2 }),
    },
    {
      name: 'unique duplicado (P2002) → 409 CONFLICT con details.target',
      request: { method: 'POST', url: '/api/v1/test/unique' },
      status: 409,
      code: 'CONFLICT',
      check: (body: ApiErrorDto) =>
        expect(body.details).toMatchObject({ target: 'brand_name_key' }),
    },
    {
      name: 'CHECK violado por SQL crudo → 409 con details.constraint',
      request: { method: 'POST', url: '/api/v1/test/check-raw' },
      status: 409,
      code: 'CONFLICT',
      check: (body: ApiErrorDto) =>
        expect(body.details).toEqual({ constraint: 'branch_tax_rate_bp_check' }),
    },
    {
      name: "Error('x') → 500 INTERNAL_ERROR sin el detalle ni el stack",
      request: { method: 'GET', url: '/api/v1/test/boom' },
      status: 500,
      code: 'INTERNAL_ERROR',
      check: (body: ApiErrorDto, raw: string) => {
        expect(raw).not.toContain('detalle-interno-secreto');
        expect(raw).not.toMatch(/at .*\.ts/);
        expect(Object.keys(body).sort()).toEqual(['code', 'message']);
      },
    },
    {
      name: 'ruta inexistente → 404 NOT_FOUND',
      request: { method: 'GET', url: '/api/v1/no-existe' },
      status: 404,
      code: 'NOT_FOUND',
    },
  ])('$name', async ({ request, status, code, check }) => {
    const res = await app.inject(request);
    expect(res.statusCode).toBe(status);
    const body = ApiErrorDto.parse(res.json());
    expect(body.code).toBe(code);
    check?.(body, res.body);
  });
});
