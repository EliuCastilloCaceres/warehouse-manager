// Datos de prueba de Ajustes (solo los importan los tests).
import type {
  AuthSessionDto,
  BranchDto,
  CashRegisterDto,
  PermissionCode,
} from '@warehouse-manager/shared';
import { BRANCH_S1, makeSession } from '@/test/fixtures';

const NOW = '2026-10-13T15:00:00.000Z';

export function makeBranch(overrides: Partial<BranchDto> = {}): BranchDto {
  return {
    id: BRANCH_S1.id,
    code: 'S1',
    name: 'Sucursal Centro',
    legalName: 'Calzado Ejemplo SA de CV',
    taxId: 'CEJ010101AB1',
    address: 'Av. Siempre Viva 123',
    phone: '55 1234 5678',
    email: 'centro@ejemplo.mx',
    imageUrl: null,
    logoUrl: null,
    ticketHeader: '¡Bienvenido!',
    ticketFooterMessage: 'Gracias por su compra',
    promoQrText: null,
    promoQrCaption: null,
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    taxRateBp: 1600,
    pricesIncludeTax: true,
    lowStockThreshold: 2,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeRegister(code: string, name: string, n: number): CashRegisterDto {
  return {
    id: `ccccccc0-0000-4000-8000-${String(n).padStart(12, '0')}`,
    branchId: BRANCH_S1.id,
    code,
    name,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Sesión de un Vendedor con solo estos permisos de Ajustes agregados. */
export function sessionWith(permissions: PermissionCode[]): AuthSessionDto {
  const session = makeSession({ role: 'SELLER' });
  session.me.permissions = [...session.me.permissions, ...permissions].sort();
  return session;
}

export const BRANCH_URL = `/api/v1/branches/${BRANCH_S1.id}`;
