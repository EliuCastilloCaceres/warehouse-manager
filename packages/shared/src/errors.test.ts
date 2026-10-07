import { ApiErrorDto } from './index.js';

describe('ApiErrorDto (T9)', () => {
  it.each([
    { code: 'NOT_FOUND', message: 'No existe' },
    { code: 'NOT_FOUND', message: 'No existe', details: { id: 'x' } },
  ])('acepta %o', (payload) => {
    expect(ApiErrorDto.safeParse(payload).success).toBe(true);
  });

  it.each([
    { code: 'TEAPOT', message: 'No existe' },
    { code: 'NOT_FOUND', message: '' },
  ])('rechaza %o', (payload) => {
    expect(ApiErrorDto.safeParse(payload).success).toBe(false);
  });
});
