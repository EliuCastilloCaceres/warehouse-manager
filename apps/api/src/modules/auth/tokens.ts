import { createHash, randomBytes } from 'node:crypto';
import type { AccessClaims } from '../../core/types.js';
import type { AuthUser } from './auth.repository.js';

export const REFRESH_COOKIE = 'wm_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** En BD solo se guarda el SHA-256 (hex) del refresh token. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Claims del access token a partir del usuario leído de la BD. */
export function buildClaims(user: AuthUser): AccessClaims {
  return {
    sub: user.id,
    role: user.role.code,
    perms: user.permissions,
    branchIds: user.branches.map((b) => b.id),
    defaultBranchId: user.branches.find((b) => b.isDefault)?.id ?? null,
    mcp: user.mustChangePassword,
  };
}
