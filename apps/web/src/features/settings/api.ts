import {
  BranchDto,
  CashRegisterDto,
  ImageUploadDto,
  type BranchUpdateInput,
  type CashRegisterUpdateInput,
} from '@warehouse-manager/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/shared/api/apiClient';

export const branchKey = (id: string | null) => ['branch', id] as const;
export const cashRegistersKey = (branchId: string | null) => ['cash-registers', branchId] as const;

export function useBranchSettings(id: string | null) {
  return useQuery({
    queryKey: branchKey(id),
    queryFn: ({ signal }) => apiFetch(`/api/v1/branches/${id}`, { schema: BranchDto, signal }),
    enabled: !!id,
  });
}

/** Cajas de la sucursal actual (la API la toma de `X-Branch-Id`). */
export function useCashRegisters(branchId: string | null) {
  return useQuery({
    queryKey: cashRegistersKey(branchId),
    queryFn: ({ signal }) =>
      apiFetch('/api/v1/cash-registers', { schema: CashRegisterDto.array(), signal }),
    enabled: !!branchId,
  });
}

export const settingsApi = {
  updateBranch: (id: string, input: BranchUpdateInput) =>
    apiFetch(`/api/v1/branches/${id}`, { method: 'PATCH', body: input, schema: BranchDto }),
  uploadBranchImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch('/api/v1/uploads/branch-images', {
      method: 'POST',
      body: form,
      schema: ImageUploadDto,
    });
  },
  updateCashRegister: (id: string, input: CashRegisterUpdateInput) =>
    apiFetch(`/api/v1/cash-registers/${id}`, {
      method: 'PATCH',
      body: input,
      schema: CashRegisterDto,
    }),
};
