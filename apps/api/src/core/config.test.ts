import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('devuelve los defaults y convierte PORT a número (T3)', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      APP_VERSION: '0.0.0',
    });
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([
    ['PORT', { PORT: 'abc' }],
    ['PORT', { PORT: '70000' }],
    ['NODE_ENV', { NODE_ENV: 'staging' }],
  ])('lanza un error que nombra %s cuando es inválida (T4)', (variable, env) => {
    expect(() => loadConfig(env)).toThrow(variable);
  });
});
