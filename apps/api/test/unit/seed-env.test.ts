import { parseSeedEnv } from '../../prisma/seed/env.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
  OWNER_INITIAL_PASSWORD: 'clave-owner',
  ADMIN_INITIAL_PASSWORD: 'clave-admin',
};

describe('parseSeedEnv (T13)', () => {
  it('acepta un env válido', () => {
    expect(parseSeedEnv({ ...valid, OTRA: 'x' })).toEqual(valid);
  });

  it.each([
    ['DATABASE_URL', { ...valid, DATABASE_URL: undefined }],
    ['OWNER_INITIAL_PASSWORD', { ...valid, OWNER_INITIAL_PASSWORD: undefined }],
    ['ADMIN_INITIAL_PASSWORD', { ...valid, ADMIN_INITIAL_PASSWORD: undefined }],
    ['OWNER_INITIAL_PASSWORD', { ...valid, OWNER_INITIAL_PASSWORD: '1234567' }],
    ['ADMIN_INITIAL_PASSWORD', { ...valid, ADMIN_INITIAL_PASSWORD: '1234567' }],
  ])('lanza un error que nombra %s', (variable, env) => {
    expect(() => parseSeedEnv(env)).toThrow(variable);
  });
});
