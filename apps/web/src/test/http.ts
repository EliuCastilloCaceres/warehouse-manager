/** Respuesta mínima compatible con lo que usan `apiFetch` y `refreshSession`. */
export function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('sin body');
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as Response;
}

export function htmlResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  } as Response;
}

export const apiError = (
  status: number,
  code: string,
  message = 'mensaje de la API',
  details?: unknown,
) => jsonResponse(status, details === undefined ? { code, message } : { code, message, details });

type Handler = (init: RequestInit & { url: string }) => Response | Promise<Response>;

/**
 * `fetch` simulado por "MÉTODO ruta". Cada valor es un handler o una lista de handlers
 * que se consumen en orden (el último se repite).
 */
export function mockFetch(routes: Record<string, Handler | Handler[]>) {
  const counters = new Map<string, number>();
  const fn = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const key = `${init.method ?? 'GET'} ${url}`;
    const entry = routes[key];
    if (!entry) throw new Error(`fetch no simulado: ${key}`);
    const list = Array.isArray(entry) ? entry : [entry];
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    return list[Math.min(index, list.length - 1)]!({ ...init, url });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Llamadas a `fetch` hechas a una ruta ("MÉTODO ruta"). */
export function callsTo(fetchMock: jest.Mock, key: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}` === key,
  );
}

export const headersOf = (call: unknown[]) =>
  ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
