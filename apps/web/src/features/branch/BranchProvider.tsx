import type { MeDto } from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { configureApiClient } from '@/shared/api/apiClient';

type Branch = MeDto['branches'][number];

export interface BranchContextValue {
  branches: Branch[];
  branchId: string | null;
  branch: Branch | null;
  /** Más de una sucursal y ninguna elegida (o la guardada ya no es válida). */
  needsSelection: boolean;
  selectBranch: (branchId: string) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export const branchStorageKey = (userId: string) => `wm.branch.${userId}`;

function readStored(userId: string): string | null {
  try {
    return localStorage.getItem(branchStorageKey(userId));
  } catch {
    return null;
  }
}

function writeStored(userId: string, branchId: string | null): void {
  try {
    if (branchId) localStorage.setItem(branchStorageKey(userId), branchId);
    else localStorage.removeItem(branchStorageKey(userId));
  } catch {
    // Sin almacenamiento (modo privado): la elección dura lo que la pestaña.
  }
}

/** Sucursal de trabajo: elegida, guardada por usuario o la única; viaja en `X-Branch-Id`. */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const userId = me?.user.id ?? null;
  const branches = useMemo(() => me?.branches ?? [], [me]);
  const [chosen, setChosen] = useState<{ userId: string; branchId: string } | null>(null);

  const stored = userId ? readStored(userId) : null;
  const candidate = chosen && chosen.userId === userId ? chosen.branchId : stored;
  const valid = branches.some((b) => b.id === candidate) ? candidate : null;
  const branchId = valid ?? (branches.length === 1 ? branches[0]!.id : null);

  // Antes de los efectos de los hijos: la primera petición ya lleva la sucursal.
  useLayoutEffect(() => {
    configureApiClient({ getBranchId: () => branchId });
  }, [branchId]);

  useLayoutEffect(() => {
    // La guardada ya no está en `me.branches` (desasignada o inactiva): se descarta.
    if (userId && stored && !branches.some((b) => b.id === stored)) writeStored(userId, null);
  }, [userId, stored, branches]);

  const value = useMemo<BranchContextValue>(
    () => ({
      branches,
      branchId,
      branch: branches.find((b) => b.id === branchId) ?? null,
      needsSelection: branches.length > 1 && !branchId,
      selectBranch: (id) => {
        if (!userId) return;
        writeStored(userId, id);
        setChosen({ userId, branchId: id });
        queryClient.clear();
      },
    }),
    [branches, branchId, userId, queryClient],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchContextValue {
  const context = useContext(BranchContext);
  if (!context) throw new Error('useBranch debe usarse dentro de BranchProvider');
  return context;
}
