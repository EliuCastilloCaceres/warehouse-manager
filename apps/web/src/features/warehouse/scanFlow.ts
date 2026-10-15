import {
  type LocateResultDto,
  type LocateVariantDto,
  parseLocationCode,
} from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiError } from '@/shared/api/errors';
import type { ValidScan } from '@/shared/scan/ScanInput';
import { inventoryApi } from './api';

export interface ResolvedRack {
  id: string;
  locationCode: string;
  isStaging: boolean;
}

/**
 * Código de ubicación de la lectura, o `null`. Además del QR (`LOC:A-01-03`) acepta el código
 * tecleado sin prefijo (`A-01-03`, `a-1-3`), que `classifyScan` toma como SKU: úsese solo en los
 * pasos que esperan una ubicación.
 */
export function locationCodeOf(scan: ValidScan): string | null {
  if (scan.kind === 'location') return scan.code;
  if (scan.kind === 'product') return parseLocationCode(scan.code)?.code ?? null;
  return null;
}

/** Disponibles de la variante en staging (lo que se puede ubicar "desde staging"). */
export function stagingAvailable(item: LocateVariantDto): number {
  return item.locations.filter((l) => l.isStaging).reduce((sum, l) => sum + l.available, 0);
}

/** `locate` y `by-location` con la caché de TanStack Query (varios escaneos del mismo código). */
export function useScanLookups() {
  const queryClient = useQueryClient();

  const locate = useCallback(
    (code: string): Promise<LocateResultDto | null> =>
      queryClient
        .fetchQuery({
          queryKey: ['locate', code],
          queryFn: () => inventoryApi.locate(code),
          staleTime: 30_000,
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
          throw error;
        }),
    [queryClient],
  );

  const rack = useCallback(async (code: string): Promise<ResolvedRack | null> => {
    try {
      const { node } = await inventoryApi.byLocation(code);
      return { id: node.id, locationCode: node.code, isStaging: node.isStaging };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }, []);

  return { locate, rack };
}
