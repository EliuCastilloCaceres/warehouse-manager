import {
  paginated,
  PasswordResetResultDto,
  PermissionGroupDto,
  RoleWithPermissionsDto,
  UserCreatedDto,
  UserDetailDto,
  UserListItemDto,
  UsernameSuggestionDto,
  type PasswordInput,
  type UserCreateInput,
  type UserUpdateInput,
} from '@warehouse-manager/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/shared/api/apiClient';

const UserPage = paginated(UserListItemDto);
const BASE = '/api/v1/users';

export type UserStatusFilter = 'active' | 'inactive' | 'all';

export interface UserFilters {
  q: string;
  status: UserStatusFilter;
  roleId: string;
  branchId: string;
  page: number;
}

export const USERS_PAGE_SIZE = 20;

/** Query string de `GET /users` (spec F4 §6); los filtros vacíos no se envían. */
export function usersSearch({ q, status, roleId, branchId, page }: UserFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(USERS_PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (status !== 'all') params.set('isActive', String(status === 'active'));
  if (roleId) params.set('roleId', roleId);
  if (branchId) params.set('branchId', branchId);
  return params.toString();
}

export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: ['users', filters],
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}?${usersSearch(filters)}`, { schema: UserPage, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: ({ signal }) => apiFetch(`${BASE}/${id}`, { schema: UserDetailDto, signal }),
    enabled: !!id,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) =>
      apiFetch('/api/v1/roles', { schema: RoleWithPermissionsDto.array(), signal }),
  });
}

export function usePermissionGroups() {
  return useQuery({
    queryKey: ['permissions'],
    queryFn: ({ signal }) =>
      apiFetch('/api/v1/permissions', { schema: PermissionGroupDto.array(), signal }),
    staleTime: Infinity,
  });
}

/** Tras una mutación: la lista y el detalle se vuelven a pedir. */
export function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user'] }),
      ]),
    [queryClient],
  );
}

export const usersApi = {
  suggestUsername: (fullName: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/suggest-username?${new URLSearchParams({ fullName })}`, {
      schema: UsernameSuggestionDto,
      signal,
    }),
  create: (input: UserCreateInput) =>
    apiFetch(BASE, { method: 'POST', body: input, schema: UserCreatedDto }),
  update: (id: string, input: UserUpdateInput) =>
    apiFetch(`${BASE}/${id}`, { method: 'PATCH', body: input, schema: UserDetailDto }),
  deactivate: (id: string) =>
    apiFetch(`${BASE}/${id}/deactivate`, { method: 'POST', schema: UserDetailDto }),
  reactivate: (id: string) =>
    apiFetch(`${BASE}/${id}/reactivate`, { method: 'POST', schema: UserDetailDto }),
  resetPassword: (id: string, input: PasswordInput) =>
    apiFetch(`${BASE}/${id}/reset-password`, {
      method: 'POST',
      body: input,
      schema: PasswordResetResultDto,
    }),
};
