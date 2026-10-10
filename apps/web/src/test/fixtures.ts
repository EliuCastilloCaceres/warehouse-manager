import {
  type AuthSessionDto,
  type MeDto,
  SYSTEM_ROLES,
  type SystemRoleCode,
} from '@warehouse-manager/shared';

export const BRANCH_S1 = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'S1',
  name: 'Sucursal Centro',
  isDefault: true,
};
export const BRANCH_S2 = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'S2',
  name: 'Sucursal Norte',
  isDefault: false,
};

export interface MeOptions {
  role?: SystemRoleCode;
  mustChangePassword?: boolean;
  branches?: MeDto['branches'];
  userId?: string;
}

/** `MeDto` de prueba con los permisos del rol del sistema. */
export function makeMe({
  role = 'ADMIN',
  mustChangePassword = false,
  branches = [BRANCH_S1],
  userId = '33333333-3333-4333-8333-333333333333',
}: MeOptions = {}): MeDto {
  const systemRole = SYSTEM_ROLES.find((r) => r.code === role)!;
  return {
    user: {
      id: userId,
      username: 'ecastillo',
      fullName: 'Eliu Castillo',
      mustChangePassword,
      role: { code: role, name: systemRole.name },
    },
    permissions: [...systemRole.permissions].sort(),
    branches,
  };
}

let tokenCounter = 0;

export function makeSession(options: MeOptions = {}): AuthSessionDto {
  return { accessToken: `token-${++tokenCounter}`, expiresIn: 900, me: makeMe(options) };
}
