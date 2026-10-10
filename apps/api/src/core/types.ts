import type { PermissionCode } from '@warehouse-manager/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import type { AuditService } from './audit/audit.service.js';
import type { AppConfig } from './config.js';
import type { StorageService } from './storage/storage.service.js';

/** Acceso que declara cada ruta bajo /api/v1 (`config.access`). */
export type RouteAccess = 'public' | 'authenticated' | { permission: PermissionCode };

/** Claims del access token (spec F2 §2). */
export interface AccessClaims {
  sub: string;
  role: string;
  perms: PermissionCode[];
  branchIds: string[];
  defaultBranchId: string | null;
  mcp: boolean;
}

/** Usuario autenticado de la petición, derivado de los claims. */
export interface AuthContext {
  userId: string;
  role: string;
  permissions: PermissionCode[];
  branchIds: string[];
  defaultBranchId: string | null;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
    /** Permite la ruta aunque el usuario deba cambiar su contraseña (`mcp`). */
    allowDuringPasswordChange?: boolean;
    /** Resuelve `request.branchId` (header `X-Branch-Id` o la sucursal por defecto). */
    branchScoped?: boolean;
    /** Rechaza la petición si `Origin` no coincide con `Host`. */
    checkOrigin?: boolean;
  }

  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    storage: StorageService;
    audit: AuditService;
    authService: AuthService;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    branchId: string | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}
