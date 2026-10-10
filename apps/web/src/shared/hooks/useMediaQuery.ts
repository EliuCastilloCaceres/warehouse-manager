import { useCallback, useSyncExternalStore } from 'react';

/** `true` si la media query coincide; se actualiza al cambiar el tamaño de la ventana. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoint `md` de Tailwind: tabla y diálogo desde aquí; tarjetas y hoja inferior por debajo. */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
