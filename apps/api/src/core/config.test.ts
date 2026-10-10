import { loadConfig } from './config.js';

// Variables obligatorias desde F2 (regresión declarada de F0: T3 y T4 las incluyen).
const REQUIRED = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
  JWT_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('devuelve los defaults y convierte PORT a número (T3 de F0)', () => {
    expect(loadConfig(REQUIRED)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      APP_VERSION: '0.0.0',
    });
    expect(loadConfig({ ...REQUIRED, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([
    ['PORT', { PORT: 'abc' }],
    ['PORT', { PORT: '70000' }],
    ['NODE_ENV', { NODE_ENV: 'staging' }],
  ])('lanza un error que nombra %s cuando es inválida (T4 de F0)', (variable, env) => {
    expect(() => loadConfig({ ...REQUIRED, ...env })).toThrow(variable);
  });

  it('defaults de F2 y coerción (T1)', () => {
    expect(loadConfig(REQUIRED)).toMatchObject({
      ...REQUIRED,
      ACCESS_TTL_MIN: 15,
      REFRESH_TTL_DAYS: 7,
      COOKIE_SECURE: true,
      UPLOADS_DIR: 'uploads',
      TRUST_PROXY: false,
    });
    expect(
      loadConfig({
        ...REQUIRED,
        ACCESS_TTL_MIN: '30',
        REFRESH_TTL_DAYS: '30',
        COOKIE_SECURE: 'false',
        TRUST_PROXY: 'true',
      }),
    ).toMatchObject({
      ACCESS_TTL_MIN: 30,
      REFRESH_TTL_DAYS: 30,
      COOKIE_SECURE: false,
      TRUST_PROXY: true,
    });
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: undefined }],
    ['DATABASE_URL', { DATABASE_URL: 'mysql://u:p@localhost/x' }],
    ['JWT_SECRET', { JWT_SECRET: 'a'.repeat(31) }],
    ['REFRESH_TTL_DAYS', { REFRESH_TTL_DAYS: '31' }],
    ['ACCESS_TTL_MIN', { ACCESS_TTL_MIN: '0' }],
    ['COOKIE_SECURE', { COOKIE_SECURE: 'si' }],
  ])('lanza un error que nombra %s (T2)', (variable, env) => {
    expect(() => loadConfig({ ...REQUIRED, ...env })).toThrow(variable);
  });
});
