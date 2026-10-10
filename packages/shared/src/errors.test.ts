import { ApiErrorDto, ErrorCode, ValidationIssue } from './index.js';

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

describe('códigos de F2 y ValidationIssue (T8 de F2)', () => {
  it('los 14 códigos nuevos existen', () => {
    const nuevos = [
      'AUTH_REFRESH_INVALID',
      'AUTH_REFRESH_REUSED',
      'AUTH_PASSWORD_CHANGE_REQUIRED',
      'AUTH_PASSWORD_INCORRECT',
      'AUTH_ORIGIN_FORBIDDEN',
      'BRANCH_FORBIDDEN',
      'BRANCH_REQUIRED',
      'RATE_LIMITED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'DB_UNAVAILABLE',
      'RACK_INACTIVE',
      'INVENTORY_CROSS_WAREHOUSE',
      'INVENTORY_INVALID_OPERATION',
    ];
    expect(nuevos).toHaveLength(14);
    for (const code of nuevos) expect(ErrorCode.options).toContain(code);
  });

  it('ValidationIssue acepta { path, message } y rechaza otros', () => {
    expect(ValidationIssue.safeParse({ path: 'username', message: 'Requerido' }).success).toBe(
      true,
    );
    expect(ValidationIssue.safeParse({ path: 'username' }).success).toBe(false);
  });
});
