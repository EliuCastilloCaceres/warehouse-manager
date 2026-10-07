import { z } from 'zod';
import { IsoDateTime, Uuid } from '../common.js';
import { UserType } from '../enums.js';

/** Sin `passwordHash`. */
export const UserDto = z.object({
  id: Uuid,
  username: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roleId: Uuid,
  type: UserType,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type UserDto = z.infer<typeof UserDto>;

export const RoleDto = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RoleDto = z.infer<typeof RoleDto>;

export const PermissionDto = z.object({
  id: Uuid,
  code: z.string(),
  module: z.string(),
  description: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PermissionDto = z.infer<typeof PermissionDto>;
