import {
  type CartCreateInput,
  CartDetailDto,
  type CartItemAddInput,
  type CartItemUpdateInput,
  CartSummaryDto,
  type CartSuspendInput,
  type CartUpdateInput,
  type CheckoutInput,
  type CloseSessionInput,
  CashSessionSummaryDto,
  LocateResultDto,
  type OpenSessionInput,
  paginated,
  PosRegisterDto,
  PosSessionDto,
  ReleaseCartsResultDto,
  type ReleaseTo,
  type SaleCancelInput,
  SaleListItemDto,
  SaleTicketDto,
  TicketBranchDto,
} from '@warehouse-manager/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useBranch } from '@/features/branch/BranchProvider';
import { apiFetch } from '@/shared/api/apiClient';
import { type DeviceRegister, readDeviceRegister, writeDeviceRegister } from './device';

const API = '/api/v1/pos';

export const SALES_PAGE_SIZE = 50;
/** La lista de carritos de la sucursal se refresca sola para ver los de otros vendedores. */
export const BRANCH_CARTS_REFRESH_MS = 15_000;

export type CartScope = 'mine' | 'all';

export function cartsSearch(scope: CartScope, number?: number): string {
  const params = new URLSearchParams({ scope });
  if (number !== undefined) params.set('number', String(number));
  return `?${params}`;
}

const post = <T>(path: string, body: unknown, schema: { parse: (v: unknown) => T }) =>
  apiFetch(`${API}${path}`, { method: 'POST', body, schema });

/** Llamadas al POS (spec F8 §6). */
export const posApi = {
  branch: () => apiFetch(`${API}/branch`, { schema: TicketBranchDto }),
  lookup: (code: string) =>
    apiFetch(`${API}/lookup?${new URLSearchParams({ code })}`, { schema: LocateResultDto }),
  registers: () => apiFetch(`${API}/cash-registers`, { schema: PosRegisterDto.array() }),
  openSession: (input: OpenSessionInput) => post('/cash-sessions/open', input, PosSessionDto),
  session: (id: string) => apiFetch(`${API}/cash-sessions/${id}`, { schema: PosSessionDto }),
  sessionSales: (id: string) =>
    apiFetch(`${API}/cash-sessions/${id}/sales?pageSize=${SALES_PAGE_SIZE}`, {
      schema: paginated(SaleListItemDto),
    }),
  closeSession: (id: string, input: CloseSessionInput) =>
    post(`/cash-sessions/${id}/close`, input, CashSessionSummaryDto),
  carts: (scope: CartScope, number?: number) =>
    apiFetch(`${API}/carts${cartsSearch(scope, number)}`, { schema: CartSummaryDto.array() }),
  createCart: (input: CartCreateInput = {}) => post('/carts', input, CartDetailDto),
  releaseAll: (releaseTo: ReleaseTo) =>
    post('/carts/release-all', { releaseTo }, ReleaseCartsResultDto),
  cart: (id: string) => apiFetch(`${API}/carts/${id}`, { schema: CartDetailDto }),
  updateCart: (id: string, input: CartUpdateInput) =>
    apiFetch(`${API}/carts/${id}`, { method: 'PATCH', body: input, schema: CartDetailDto }),
  suspend: (id: string, input: CartSuspendInput) =>
    post(`/carts/${id}/suspend`, input, CartDetailDto),
  resume: (id: string) => post(`/carts/${id}/resume`, {}, CartDetailDto),
  discard: (id: string, releaseTo: ReleaseTo) =>
    post(`/carts/${id}/discard`, { releaseTo }, CartDetailDto),
  addItem: (id: string, input: CartItemAddInput) =>
    post(`/carts/${id}/items`, input, CartDetailDto),
  updateItem: (id: string, itemId: string, input: Partial<CartItemUpdateInput>) =>
    apiFetch(`${API}/carts/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: input,
      schema: CartDetailDto,
    }),
  removeItem: (id: string, itemId: string, releaseTo: ReleaseTo) =>
    apiFetch(`${API}/carts/${id}/items/${itemId}?releaseTo=${releaseTo}`, {
      method: 'DELETE',
      schema: CartDetailDto,
    }),
  checkout: (id: string, input: CheckoutInput) =>
    post(`/carts/${id}/checkout`, input, SaleTicketDto),
  ticket: (saleId: string) => apiFetch(`${API}/sales/${saleId}/ticket`, { schema: SaleTicketDto }),
  cancelSale: (saleId: string, input: SaleCancelInput) =>
    post(`/sales/${saleId}/cancel`, input, SaleTicketDto),
};

/** Datos de ticket de la sucursal (zona horaria, QR de promoción…). */
export function usePosBranch() {
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['pos-branch', branchId],
    queryFn: posApi.branch,
    staleTime: 5 * 60_000,
  });
}

export function usePosRegisters() {
  const { branchId } = useBranch();
  return useQuery({ queryKey: ['pos-registers', branchId], queryFn: posApi.registers });
}

export function useCarts(scope: CartScope) {
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['pos-carts', branchId, scope],
    queryFn: () => posApi.carts(scope),
    refetchInterval: scope === 'all' ? BRANCH_CARTS_REFRESH_MS : false,
  });
}

export function useCart(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cart', id],
    queryFn: () => posApi.cart(id!),
    enabled: !!id,
  });
}

/** Tras cualquier cambio de carrito: el carrito, las listas de carritos y las búsquedas. */
export function useCartChanged() {
  const queryClient = useQueryClient();
  return useCallback(
    async (cart?: CartDetailDto) => {
      if (cart) queryClient.setQueryData(['cart', cart.id], cart);
      await Promise.all(
        ['cart', 'pos-carts', 'pos-lookup'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    [queryClient],
  );
}

/**
 * Caja del dispositivo en la sucursal actual (`wm.pos.register.<branchId>`) y su sesión.
 * `isOpen` solo si la sesión guardada sigue abierta.
 */
export function useDeviceSession() {
  const { branchId } = useBranch();
  const [version, setVersion] = useState(0);
  const stored = useMemo<DeviceRegister | null>(
    () => (branchId ? readDeviceRegister(branchId) : null),
    // `version` vuelve a leer el almacenamiento después de guardar u olvidar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchId, version],
  );
  const session = useQuery({
    queryKey: ['pos-session', stored?.sessionId],
    queryFn: () => posApi.session(stored!.sessionId),
    enabled: !!stored,
  });
  const save = useCallback(
    (value: DeviceRegister | null) => {
      if (!branchId) return;
      writeDeviceRegister(branchId, value);
      setVersion((v) => v + 1);
    },
    [branchId],
  );
  return {
    stored,
    session: session.data ?? null,
    isOpen: session.data?.status === 'OPEN',
    /** Todavía no se sabe si la caja guardada sigue abierta. */
    isPending: !!stored && session.isPending,
    save,
    forget: useCallback(() => save(null), [save]),
  };
}
