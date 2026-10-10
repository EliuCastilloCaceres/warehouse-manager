import type { IncomingMessage } from 'node:http';
import { fakePrisma, testConfig } from '../../../test/helpers/config.js';
import { buildApp } from '../../app.js';
import { genReqId, loggerOptions } from './requestContext.js';

describe('requestContext: opciones del logger e id de petición', () => {
  const req = (id?: string) => ({ headers: id ? { 'x-request-id': id } : {} }) as IncomingMessage;

  it('genReqId respeta un UUID y genera otro si no hay o no es válido', () => {
    const id = '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c';
    expect(genReqId(req(id))).toBe(id);
    expect(genReqId(req('abc'))).not.toBe('abc');
    expect(genReqId(req())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('false desactiva los logs; en desarrollo usa pino-pretty; un objeto se combina', () => {
    expect(loggerOptions(testConfig(), false)).toBe(false);
    expect(loggerOptions(testConfig({ NODE_ENV: 'development' }))).toMatchObject({
      transport: { target: 'pino-pretty' },
      redact: { censor: '[oculto]' },
    });
    expect(loggerOptions(testConfig({ NODE_ENV: 'production' }))).not.toHaveProperty('transport');
    expect(loggerOptions(testConfig(), { level: 'warn' })).toMatchObject({ level: 'warn' });
  });

  it('los serializadores incluyen headers', () => {
    const options = loggerOptions(testConfig()) as {
      serializers: { req: (r: object) => object; res: (r: object) => object };
    };
    expect(
      options.serializers.req({ method: 'GET', url: '/x', headers: { a: '1' }, ip: '1.2.3.4' }),
    ).toEqual({ method: 'GET', url: '/x', headers: { a: '1' }, remoteAddress: '1.2.3.4' });
    expect(options.serializers.res({ statusCode: 200, getHeaders: () => ({ b: '2' }) })).toEqual({
      statusCode: 200,
      headers: { b: '2' },
    });
  });

  it('sin prisma inyectado, buildApp crea su cliente y lo desconecta al cerrar', async () => {
    const app = await buildApp(testConfig(), { logger: false });
    await app.ready();
    const disconnect = jest.spyOn(app.prisma, '$disconnect');
    await app.close();
    expect(disconnect).toHaveBeenCalled();
  });

  it('con prisma inyectado no lo desconecta', async () => {
    const prisma = fakePrisma();
    const app = await buildApp(testConfig(), { prisma, logger: false });
    await app.close();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });
});
