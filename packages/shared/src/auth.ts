import { z } from 'zod';
import { Uuid } from './common.js';
import { PermissionCode } from './permissions.js';

export const PasswordPolicy = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña no puede pasar de 128 caracteres');

export const LoginInput = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(128), // sin política: no revela reglas
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordPolicy,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'La nueva contraseña debe ser distinta de la actual',
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const MeDto = z.object({
  user: z.object({
    id: Uuid,
    username: z.string(),
    fullName: z.string(),
    mustChangePassword: z.boolean(),
    role: z.object({ code: z.string(), name: z.string() }),
  }),
  permissions: z.array(PermissionCode),
  branches: z.array(
    z.object({ id: Uuid, code: z.string(), name: z.string(), isDefault: z.boolean() }),
  ),
});
export type MeDto = z.infer<typeof MeDto>;

export const AuthSessionDto = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(), // segundos
  me: MeDto,
});
export type AuthSessionDto = z.infer<typeof AuthSessionDto>;
