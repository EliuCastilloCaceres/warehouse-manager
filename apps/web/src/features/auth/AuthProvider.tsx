import type { AuthSessionDto, MeDto, PermissionCode } from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { apiFetch, configureApiClient } from '@/shared/api/apiClient';
import { NetworkError, SESSION_EXPIRED_MESSAGE } from '@/shared/api/errors';
import { refreshSession } from '@/shared/api/refresh';
import { notify } from '@/shared/ui/notify';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { type ClearReason, type Session, sessionStore, useSession } from './sessionStore';

const CHANNEL = 'wm-auth';

export interface AuthContextValue {
  session: Session | null;
  me: MeDto | null;
  applySession: (session: AuthSessionDto) => void;
  logout: () => Promise<void>;
  can: (permission: PermissionCode) => boolean;
  canAny: (permissions: readonly PermissionCode[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type BootState = 'loading' | 'ready' | 'error';

/**
 * Arranque (restaura la sesión con la cookie de refresh), logout y su propagación a las demás
 * pestañas. Va dentro del router para poder navegar.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [boot, setBoot] = useState<BootState>('loading');
  const channelRef = useRef<BroadcastChannel | null>(null);

  const clearLocal = useCallback(
    (reason: ClearReason = 'expired') => {
      sessionStore.clear(reason);
      queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => {
    configureApiClient({
      getAccessToken: () => sessionStore.get()?.accessToken ?? null,
      onTokenRefreshed: (next) => sessionStore.set(next),
      onSessionExpired: () => {
        // En el arranque no hay sesión que avisar; después, RequireAuth lleva a /login?next=.
        if (!sessionStore.get()) return;
        clearLocal();
        notify.error(SESSION_EXPIRED_MESSAGE);
      },
      onPasswordChangeRequired: () => sessionStore.markPasswordChangeRequired(),
    });
  }, [clearLocal]);

  // El estado inicial ya es `loading`; solo "Reintentar" tiene que volver a él.
  const restore = useCallback(() => {
    refreshSession().then(
      () => setBoot('ready'),
      (error: unknown) => {
        if (error instanceof NetworkError) {
          setBoot('error');
        } else {
          sessionStore.clear();
          setBoot('ready');
        }
      },
    );
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  const retry = () => {
    setBoot('loading');
    restore();
  };

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'logout') {
        clearLocal('logout');
        navigate('/login', { replace: true });
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [clearLocal, navigate]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Sin red o con error, la sesión local se cierra igual.
    }
    clearLocal('logout');
    channelRef.current?.postMessage({ type: 'logout' });
    navigate('/login', { replace: true });
  }, [clearLocal, navigate]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(session?.me.permissions ?? []);
    return {
      session,
      me: session?.me ?? null,
      applySession: (next) => sessionStore.set(next),
      logout,
      can: (permission) => permissions.has(permission),
      canAny: (list) => list.some((permission) => permissions.has(permission)),
    };
  }, [session, logout]);

  if (boot === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center">
        <p className="mb-2 text-lg font-semibold">warehouse-manager</p>
        <LoadingState />
      </div>
    );
  }
  if (boot === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <ErrorState message="No se pudo conectar con el servidor" onRetry={retry} />
      </div>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
