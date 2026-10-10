import { AuthSessionDto, ChangePasswordInput, LoginInput, MeDto } from './index.js';

const me = {
  user: {
    id: '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c',
    username: 'admin',
    fullName: 'Administrador',
    mustChangePassword: false,
    role: { code: 'ADMIN', name: 'Administrador' },
  },
  permissions: ['pos.sell', 'users.read'],
  branches: [
    { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', code: 'S1', name: 'Sucursal 1', isDefault: true },
  ],
};

describe('contratos de auth (T7)', () => {
  it('LoginInput normaliza el usuario', () => {
    expect(LoginInput.parse({ username: ' Admin ', password: 'x' }).username).toBe('admin');
  });

  it.each([
    ['menos de 8 caracteres', 'corta'],
    ['más de 128 caracteres', 'x'.repeat(129)],
  ])('ChangePasswordInput rechaza una nueva con %s', (_caso, newPassword) => {
    const result = ChangePasswordInput.safeParse({ currentPassword: 'actual-123', newPassword });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['newPassword']);
  });

  it('ChangePasswordInput rechaza una nueva igual a la actual', () => {
    const result = ChangePasswordInput.safeParse({
      currentPassword: 'misma-clave',
      newPassword: 'misma-clave',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['newPassword'],
      message: 'La nueva contraseña debe ser distinta de la actual',
    });
    expect(
      ChangePasswordInput.safeParse({ currentPassword: 'actual-123', newPassword: 'nueva-123' })
        .success,
    ).toBe(true);
  });

  it('las fixtures de MeDto y AuthSessionDto son válidas', () => {
    expect(MeDto.parse(me)).toEqual(me);
    expect(AuthSessionDto.safeParse({ accessToken: 'a.b.c', expiresIn: 900, me }).success).toBe(
      true,
    );
  });

  it('se rechazan con un permiso inexistente', () => {
    const bad = { ...me, permissions: ['pos.fly'] };
    expect(MeDto.safeParse(bad).success).toBe(false);
    expect(AuthSessionDto.safeParse({ accessToken: 'a', expiresIn: 900, me: bad }).success).toBe(
      false,
    );
  });
});
