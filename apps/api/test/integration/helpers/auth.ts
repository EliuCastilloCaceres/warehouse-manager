import type { AuthSessionDto } from '@warehouse-manager/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { REFRESH_COOKIE } from '../../../src/modules/auth/tokens.js';
import { DEFAULT_PASSWORD } from './users.js';

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Valor de la cookie `wm_rt` que pone la respuesta (o `undefined`). */
export function refreshCookieOf(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value || undefined;
}

export const withRefreshCookie = (token: string) => ({ cookie: `${REFRESH_COOKIE}=${token}` });

export interface LoggedIn {
  accessToken: string;
  cookie: string;
  session: AuthSessionDto;
}

export async function login(
  app: FastifyInstance,
  username: string,
  password = DEFAULT_PASSWORD,
): Promise<LoggedIn> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login de ${username} falló: ${res.statusCode} ${res.body}`);
  }
  const session = res.json() as AuthSessionDto;
  return { accessToken: session.accessToken, cookie: refreshCookieOf(res)!, session };
}

export function refresh(
  app: FastifyInstance,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { ...(cookie ? withRefreshCookie(cookie) : {}), ...headers },
  });
}

/** Falsea solo `Date` (spec F2 §11); el resto de timers sigue siendo real. */
export function fakeDateOnly(): void {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
    now: Date.now(),
  });
}
