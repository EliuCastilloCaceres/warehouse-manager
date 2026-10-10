/** Solo rutas internas (`/algo`, nunca `//host` ni URLs absolutas): evita redirecciones abiertas. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

/** `?next=` con la ruta actual (para volver después del login o de un paso intermedio). */
export function withNext(path: string, next: string): string {
  return next === '/' ? path : `${path}?next=${encodeURIComponent(next)}`;
}
