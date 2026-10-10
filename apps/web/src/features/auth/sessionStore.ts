import type { MeDto } from '@warehouse-manager/shared';
import { useSyncExternalStore } from 'react';

/** Sesión en memoria: el access token nunca se guarda en el navegador (spec F3 §4). */
export interface Session {
  accessToken: string;
  me: MeDto;
}

/** Por qué se cerró la sesión: tras un logout no se vuelve a la ruta anterior (`next`). */
export type ClearReason = 'expired' | 'logout';

let current: Session | null = null;
let lastClearReason: ClearReason = 'expired';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const sessionStore = {
  get: (): Session | null => current,

  lastClearReason: (): ClearReason => lastClearReason,

  set(session: { accessToken: string; me: MeDto }): void {
    current = { accessToken: session.accessToken, me: session.me };
    lastClearReason = 'expired';
    emit();
  },

  clear(reason: ClearReason = 'expired'): void {
    lastClearReason = reason;
    if (!current) return;
    current = null;
    emit();
  },

  /** 403 `AUTH_PASSWORD_CHANGE_REQUIRED`: el guard lleva a /change-password. */
  markPasswordChangeRequired(): void {
    if (!current || current.me.user.mustChangePassword) return;
    current = {
      ...current,
      me: { ...current.me, user: { ...current.me.user, mustChangePassword: true } },
    };
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): Session | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}
