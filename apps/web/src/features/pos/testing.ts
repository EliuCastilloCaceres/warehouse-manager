// Datos de prueba del POS (solo los importan los tests).
import {
  type CartDetailDto,
  type CartItemRowDto,
  type CartSummaryDto,
  type CashSessionSummaryDto,
  computeSaleTotals,
  type PermissionCode,
  type PosRegisterDto,
  type PosSessionDto,
  type SaleListItemDto,
  type SaleTicketDto,
  type SystemRoleCode,
  type TicketBranchDto,
} from '@warehouse-manager/shared';
import { ok } from '@/features/warehouse/testing';
import { BRANCH_S1, makeSession } from '@/test/fixtures';
import { cartsSearch } from './api';
import { registerStorageKey } from './device';

const NOW = '2026-10-15T15:02:00.000Z';
const stamps = { createdAt: NOW, updatedAt: NOW };

/** El usuario de la sesión de prueba (`makeMe`). */
export const ME = { id: '33333333-3333-4333-8333-333333333333', fullName: 'Eliu Castillo' };
export const ANA = { id: '44444444-4444-4444-8444-444444444444', fullName: 'Ana López' };
export const JUAN = { id: '55555555-5555-4555-8555-555555555555', fullName: 'Juan Pérez' };

export const C1 = 'c1c1c1c1-0000-4000-8000-000000000001';
export const C2 = 'c2c2c2c2-0000-4000-8000-000000000002';
export const SESSION_C1 = '5e551011-0000-4000-8000-000000000001';
export const RACK_A1 = 'aaaaaaaa-0000-4000-8000-0000000000a1';
export const RACK_STG = 'aaaaaaaa-0000-4000-8000-000000000057';

let counter = 0;
export const uuid = (prefix = 'ffffffff') =>
  `${prefix}-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function makeTicketBranch(overrides: Partial<TicketBranchDto> = {}): TicketBranchDto {
  return {
    code: 'S1',
    name: 'Sucursal Centro',
    legalName: 'Calzado del Centro SA de CV',
    taxId: 'CAL010101AB1',
    address: 'Av. Juárez 10',
    phone: '55 0000 1111',
    logoUrl: null,
    ticketHeader: 'Abierto de 9 a 21',
    ticketFooterMessage: 'Gracias por su compra',
    promoQrText: 'DESC10',
    promoQrCaption: 'Muestra este QR al cajero en tu próxima compra',
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    ...overrides,
  };
}

export function makeSessionDto(overrides: Partial<PosSessionDto> = {}): PosSessionDto {
  return {
    id: SESSION_C1,
    cashRegisterId: C1,
    openedById: ME.id,
    openedAt: NOW,
    openingAmount: 50000,
    closedById: null,
    closedAt: null,
    expectedAmount: null,
    countedAmount: null,
    difference: null,
    status: 'OPEN',
    ...stamps,
    cashRegister: { id: C1, code: 'C1', name: 'Caja 1' },
    openedBy: { id: ME.id, fullName: 'Luis Mora' },
    closedBy: null,
    ...overrides,
  };
}

export function makeRegister(
  code: 'C1' | 'C2',
  openSession: PosRegisterDto['openSession'] = null,
): PosRegisterDto {
  return {
    id: code === 'C1' ? C1 : C2,
    branchId: BRANCH_S1.id,
    code,
    name: code === 'C1' ? 'Caja 1' : 'Caja 2',
    isActive: true,
    ...stamps,
    openSession,
  };
}

/** C1 abierta por Luis a las 9:02 (hora de la sucursal) y C2 cerrada. */
export const REGISTERS = [
  makeRegister('C1', {
    id: SESSION_C1,
    openedAt: NOW,
    openedBy: { id: ME.id, fullName: 'Luis Mora' },
  }),
  makeRegister('C2'),
];

export function makeItem(overrides: Partial<CartItemRowDto> = {}): CartItemRowDto {
  const item = {
    id: uuid('11110000'),
    cartId: uuid('22220000'),
    variantId: uuid('33330000'),
    sourceRackId: RACK_A1,
    quantity: 1,
    unitPrice: 89900,
    discount: 0,
    ...stamps,
    sku: 'ZAP0101-25-NEG',
    barcode: '7501234567890',
    productName: 'Zapato de piel dama',
    variantLabel: '25 · Negro',
    thumbUrl: null,
    locationCode: 'A-01-01',
    isStaging: false,
    lineTotal: 0,
    ...overrides,
  };
  return { ...item, lineTotal: item.unitPrice * item.quantity - item.discount };
}

export const BELT = (overrides: Partial<CartItemRowDto> = {}) =>
  makeItem({
    sku: 'CIN0001',
    barcode: null,
    productName: 'Cinturón',
    variantLabel: null,
    unitPrice: 34900,
    locationCode: 'C-01-01',
    ...overrides,
  });

/** Carrito con totales calculados como la API (IVA incluido al 16 %). */
export function makeCart(
  items: CartItemRowDto[] = [],
  overrides: Partial<Omit<CartDetailDto, 'items' | 'totals'>> = {},
): CartDetailDto {
  const id = overrides.id ?? uuid('ca770000');
  const discount = overrides.discount ?? 0;
  const totals = computeSaleTotals({
    lines: items,
    globalDiscount: discount,
    taxRateBp: 1600,
    pricesIncludeTax: true,
  });
  return {
    id,
    branchId: BRANCH_S1.id,
    userId: ME.id,
    number: 12,
    status: 'ACTIVE',
    label: null,
    customerName: null,
    discount,
    ...stamps,
    owner: ME,
    ...overrides,
    items: items.map((item) => ({ ...item, cartId: id })),
    totals: { ...totals, taxRateBp: 1600, pricesIncludeTax: true },
  };
}

export function summaryOf(cart: CartDetailDto): CartSummaryDto {
  const { items, totals, ...rest } = cart;
  return {
    ...rest,
    itemCount: items.length,
    unitCount: items.reduce((sum, item) => sum + item.quantity, 0),
    total: totals.total,
  };
}

export function makeTicket(overrides: Partial<SaleTicketDto> = {}): SaleTicketDto {
  const saleId = uuid('5a1e0000');
  return {
    sale: {
      id: saleId,
      folio: 'S1-000001',
      branchId: BRANCH_S1.id,
      cashRegisterId: C1,
      cashSessionId: SESSION_C1,
      sellerId: ANA.id,
      cashierId: ME.id,
      cartId: uuid('ca770000'),
      customerName: 'María',
      subtotal: 124800,
      globalDiscount: 0,
      discountTotal: 10000,
      taxRateBp: 1600,
      pricesIncludeTax: true,
      taxTotal: 15834,
      total: 114800,
      status: 'COMPLETED',
      cancelledAt: null,
      cancelledById: null,
      cancelReason: null,
      createdAt: '2026-10-15T00:30:00.000Z',
      updatedAt: NOW,
    },
    items: [
      {
        id: uuid('5a1e1111'),
        saleId,
        variantId: uuid('33330000'),
        sourceRackId: RACK_A1,
        skuSnapshot: 'ZAP0101-25-NEG',
        nameSnapshot: 'Zapato de piel dama',
        variantLabelSnapshot: '25 · Negro',
        unitPrice: 89900,
        quantity: 1,
        discount: 10000,
        lineTotal: 79900,
        createdAt: NOW,
      },
      {
        id: uuid('5a1e1111'),
        saleId,
        variantId: uuid('33330000'),
        sourceRackId: RACK_A1,
        skuSnapshot: 'CIN0001',
        nameSnapshot: 'Cinturón',
        variantLabelSnapshot: null,
        unitPrice: 34900,
        quantity: 1,
        discount: 0,
        lineTotal: 34900,
        createdAt: NOW,
      },
    ],
    payments: [
      {
        id: uuid('9a700000'),
        saleId,
        method: 'CASH',
        amount: 84800,
        received: 90000,
        change: 5200,
        reference: null,
        createdAt: NOW,
      },
      {
        id: uuid('9a700000'),
        saleId,
        method: 'CARD',
        amount: 30000,
        received: null,
        change: null,
        reference: 'AUT-123',
        createdAt: NOW,
      },
    ],
    branch: makeTicketBranch(),
    cashRegister: { code: 'C1', name: 'Caja 1' },
    seller: ANA,
    cashier: ME,
    cancelledBy: null,
    ...overrides,
  };
}

export function makeSaleListItem(overrides: Partial<SaleListItemDto> = {}): SaleListItemDto {
  return {
    id: uuid('5a1e0000'),
    folio: 'S1-000001',
    createdAt: '2026-10-15T16:15:00.000Z',
    total: 124800,
    status: 'COMPLETED',
    customerName: null,
    seller: ANA,
    cashier: ME,
    methods: ['CASH'],
    ...overrides,
  };
}

export function makeCloseSummary(
  overrides: Partial<CashSessionSummaryDto> = {},
): CashSessionSummaryDto {
  return {
    session: makeSessionDto({
      status: 'CLOSED',
      closedById: ANA.id,
      closedAt: '2026-10-16T02:00:00.000Z',
      expectedAmount: 570000,
      countedAmount: 568000,
      difference: -2000,
      closedBy: ANA,
    }),
    salesCount: 12,
    salesTotal: 845000,
    cancelledCount: 1,
    cancelledTotal: 34900,
    byMethod: [
      { method: 'CASH', count: 8, amount: 520000 },
      { method: 'CARD', count: 3, amount: 275000 },
      { method: 'TRANSFER', count: 1, amount: 50000 },
    ],
    expectedAmount: 570000,
    countedAmount: 568000,
    difference: -2000,
    ...overrides,
  };
}

// ─── Claves de `mockFetch` ───────────────────────────────────────────────────

const API = '/api/v1/pos';
export const BRANCH_KEY = `GET ${API}/branch`;
export const REGISTERS_KEY = `GET ${API}/cash-registers`;
export const OPEN_SESSION_KEY = `POST ${API}/cash-sessions/open`;
export const sessionKey = (id = SESSION_C1) => `GET ${API}/cash-sessions/${id}`;
export const sessionSalesKey = (id = SESSION_C1) =>
  `GET ${API}/cash-sessions/${id}/sales?pageSize=50`;
export const closeKey = (id = SESSION_C1) => `POST ${API}/cash-sessions/${id}/close`;
export const cartsKey = (scope: 'mine' | 'all', number?: number) =>
  `GET ${API}/carts${cartsSearch(scope, number)}`;
export const CREATE_CART_KEY = `POST ${API}/carts`;
export const RELEASE_ALL_KEY = `POST ${API}/carts/release-all`;
export const cartKey = (id: string) => `GET ${API}/carts/${id}`;
export const cartPatchKey = (id: string) => `PATCH ${API}/carts/${id}`;
export const cartActionKey = (
  id: string,
  action: 'suspend' | 'resume' | 'discard' | 'items' | 'checkout',
) => `POST ${API}/carts/${id}/${action}`;
export const itemKey = (cartId: string, itemId: string) =>
  `PATCH ${API}/carts/${cartId}/items/${itemId}`;
export const removeItemKey = (cartId: string, itemId: string, releaseTo = 'RACK') =>
  `DELETE ${API}/carts/${cartId}/items/${itemId}?releaseTo=${releaseTo}`;
export const lookupKey = (code: string) => `GET ${API}/lookup?${new URLSearchParams({ code })}`;
export const ticketKey = (saleId: string) => `GET ${API}/sales/${saleId}/ticket`;
export const cancelKey = (saleId: string) => `POST ${API}/sales/${saleId}/cancel`;

export { ok };
/** Handler de `mockFetch` que responde 201 con `body` (sin depender de Jest, como `ok`). */
export const created = (body: unknown) => () =>
  ({ ok: true, status: 201, json: async () => body }) as unknown as Response;

/** Rutas simuladas con la sesión del rol (más permisos extra, o sin algunos) y la sucursal. */
export function posRoutes<R extends object>(
  routes: R,
  {
    role = 'SELLER',
    add = [],
    remove = [],
  }: { role?: SystemRoleCode; add?: PermissionCode[]; remove?: PermissionCode[] } = {},
) {
  const session = makeSession({ role });
  session.me.permissions = [...session.me.permissions, ...add]
    .filter((p) => !remove.includes(p))
    .sort();
  return {
    'POST /api/v1/auth/refresh': ok(session),
    [BRANCH_KEY]: ok(makeTicketBranch()),
    [REGISTERS_KEY]: ok(REGISTERS),
    ...routes,
  };
}

/** La caja que recuerda el dispositivo (`wm.pos.register.<branchId>`). */
export function saveDeviceRegister(registerId = C1, sessionId = SESSION_C1) {
  localStorage.setItem(registerStorageKey(BRANCH_S1.id), JSON.stringify({ registerId, sessionId }));
}
