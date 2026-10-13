import {
  isAssignableRole,
  isWithinScope,
  missingPermissions,
  PermissionGroupDto,
  RoleWithPermissionsDto,
  suggestUsernameBase,
  SYSTEM_ROLES,
  UserCreatedDto,
  UserCreateInput,
  UserDetailDto,
  UserListQuery,
  UsernameSchema,
  UserUpdateInput,
  type PermissionCode,
  type SystemRoleCode,
} from './index.js';

const ROLE_ID = '0b9e8f7d-6c5b-4a3f-8e2d-1c0b9a8f7e6d';
const S1 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const S2 = '1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a0b';
const NOW = '2026-10-12T15:00:00.000Z';

const permsOf = (code: SystemRoleCode): PermissionCode[] => [
  ...SYSTEM_ROLES.find((r) => r.code === code)!.permissions,
];

describe('UsernameSchema (T1)', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(UsernameSchema.parse(' JPerez ')).toBe('jperez');
  });

  it('acepta punto, guion bajo y números', () => {
    expect(UsernameSchema.parse('j.perez_2')).toBe('j.perez_2');
  });

  it.each([
    ['menos de 3 caracteres', 'jp'],
    ['31 caracteres', 'a'.repeat(31)],
    ['un espacio', 'juan perez'],
    ['una ñ', 'ñandu'],
  ])('rechaza %s', (_caso, value) => {
    const result = UsernameSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo',
    );
  });
});

describe('suggestUsernameBase (T2)', () => {
  it.each([
    ['Juan Pérez López', 'jperez'],
    ['Ana', 'ana'],
    ["José O'Brien", 'jobrien'],
    ['Lu', null],
    ['   ', null],
    ['Ñoño Muñoz', 'nmunoz'],
  ])('%j → %j', (fullName, expected) => {
    expect(suggestUsernameBase(fullName)).toBe(expected);
  });

  it('un nombre muy largo se recorta a 30', () => {
    expect(suggestUsernameBase('x'.repeat(40))).toBe('x'.repeat(30));
    expect(suggestUsernameBase(`Juan ${'Bartolomeo'.repeat(4)}`)).toBe(
      `j${'bartolomeo'.repeat(4)}`.slice(0, 30),
    );
  });
});

const createInput = {
  username: 'jperez',
  fullName: 'Juan Pérez',
  roleId: ROLE_ID,
  branchIds: [S1],
  defaultBranchId: S1,
  password: { mode: 'generate' },
};

describe('UserCreateInput (T3)', () => {
  it('válido con generate y con manual; aplica defaults', () => {
    expect(UserCreateInput.parse(createInput)).toEqual({
      ...createInput,
      email: null,
      phone: null,
      extraPermissions: [],
    });
    expect(
      UserCreateInput.safeParse({
        ...createInput,
        password: { mode: 'manual', value: 'clave-123' },
      }).success,
    ).toBe(true);
  });

  it('manual con 7 caracteres → error en password.value', () => {
    const result = UserCreateInput.safeParse({
      ...createInput,
      password: { mode: 'manual', value: '1234567' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['password', 'value']);
  });

  it('branchIds vacío → error', () => {
    const result = UserCreateInput.safeParse({ ...createInput, branchIds: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['branchIds'],
      message: 'Elige al menos una sucursal',
    });
  });

  it('defaultBranchId fuera de branchIds → error en defaultBranchId', () => {
    const result = UserCreateInput.safeParse({ ...createInput, defaultBranchId: S2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['defaultBranchId'],
      message: 'La sucursal predeterminada debe estar entre las asignadas',
    });
  });

  it('permiso inexistente → error', () => {
    expect(
      UserCreateInput.safeParse({ ...createInput, extraPermissions: ['pos.fly'] }).success,
    ).toBe(false);
  });

  it('los extras se deduplican y ordenan; las sucursales se deduplican', () => {
    const parsed = UserCreateInput.parse({
      ...createInput,
      branchIds: [S1, S1],
      extraPermissions: ['users.read', 'pos.sell', 'users.read'],
    });
    expect(parsed.extraPermissions).toEqual(['pos.sell', 'users.read']);
    expect(parsed.branchIds).toEqual([S1]);
  });
});

describe('UserUpdateInput y UserListQuery (T4)', () => {
  it('{} → "Debes cambiar al menos un campo"', () => {
    const result = UserUpdateInput.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Debes cambiar al menos un campo');
  });

  it('con username → error (objeto estricto)', () => {
    const result = UserUpdateInput.safeParse({ username: 'otro', fullName: 'Otro' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('un cambio parcial es válido', () => {
    expect(UserUpdateInput.parse({ phone: '555 123 4567' })).toEqual({ phone: '555 123 4567' });
    expect(UserUpdateInput.parse({ email: null })).toEqual({ email: null });
  });

  it('branchIds sin defaultBranchId → error', () => {
    const result = UserUpdateInput.safeParse({ branchIds: [S1] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['defaultBranchId']);
    expect(UserUpdateInput.safeParse({ branchIds: [S1], defaultBranchId: S1 }).success).toBe(true);
  });

  it('UserListQuery: isActive "false" → false; sort acepta fullName:asc y rechaza email:asc', () => {
    expect(UserListQuery.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(UserListQuery.parse({ isActive: 'true' }).isActive).toBe(true);
    expect(UserListQuery.parse({}).isActive).toBeUndefined();
    expect(UserListQuery.parse({ sort: 'fullName:asc' }).sort).toEqual({
      field: 'fullName',
      direction: 'asc',
    });
    expect(UserListQuery.safeParse({ sort: 'email:asc' }).success).toBe(false);
  });
});

describe('reglas puras (T5)', () => {
  it.each([
    ['ADMIN', 'MANAGER', true],
    ['MANAGER', 'ADMIN', false],
    ['ADMIN', 'ADMIN', true],
    ['MANAGER', 'SELLER', true],
    ['SELLER', 'WAREHOUSE_CLERK', false],
  ] as const)('isWithinScope(%s sobre %s) → %s', (actor, target, expected) => {
    expect(isWithinScope(permsOf(actor), permsOf(target))).toBe(expected);
  });

  it("missingPermissions(MANAGER, ADMIN) → ['users.permissions']", () => {
    expect(missingPermissions(permsOf('MANAGER'), permsOf('ADMIN'))).toEqual(['users.permissions']);
    expect(missingPermissions(permsOf('ADMIN'), permsOf('MANAGER'))).toEqual([]);
  });

  it.each(SYSTEM_ROLES.map((r) => r.code))('OWNER nunca es asignable para %s', (actor) => {
    expect(isAssignableRole('OWNER', permsOf('OWNER'), permsOf(actor))).toBe(false);
  });

  it.each([
    ['MANAGER', false],
    ['ADMIN', true],
  ] as const)('ADMIN asignable para %s → %s', (actor, expected) => {
    expect(isAssignableRole('ADMIN', permsOf('ADMIN'), permsOf(actor))).toBe(expected);
  });
});

const detail = {
  id: '3f2b8c1e-5d4a-4e7b-9c2d-1a0b9e8f7d6c',
  username: 'jperez',
  fullName: 'Juan Pérez',
  email: null,
  phone: null,
  roleId: ROLE_ID,
  type: 'STAFF',
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  role: { id: ROLE_ID, code: 'SELLER', name: 'Vendedor' },
  branches: [{ id: S1, code: 'S1', name: 'Sucursal 1', isDefault: true }],
  extraPermissions: ['inventory.adjust'],
  effectivePermissions: [...permsOf('SELLER'), 'inventory.adjust'].sort(),
};

describe('códigos y DTOs de usuarios (T6)', () => {
  it('las fixtures de los DTOs son válidas', () => {
    expect(UserDetailDto.parse(detail)).toEqual(detail);
    expect(UserCreatedDto.parse({ user: detail, generatedPassword: 'k7mp-x3qa-9vtw' })).toEqual({
      user: detail,
      generatedPassword: 'k7mp-x3qa-9vtw',
    });
    expect(
      RoleWithPermissionsDto.safeParse({
        id: ROLE_ID,
        code: 'SELLER',
        name: 'Vendedor',
        isSystem: true,
        createdAt: NOW,
        updatedAt: NOW,
        permissions: permsOf('SELLER'),
        assignable: true,
      }).success,
    ).toBe(true);
    expect(
      PermissionGroupDto.safeParse({
        module: 'users',
        permissions: [{ code: 'users.read', description: 'Ver usuarios' }],
      }).success,
    ).toBe(true);
    expect(PermissionGroupDto.safeParse({ module: 'billing', permissions: [] }).success).toBe(
      false,
    );
  });

  it('UserDetailDto descarta passwordHash', () => {
    const parsed = UserDetailDto.parse({ ...detail, passwordHash: '$argon2id$...' });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
