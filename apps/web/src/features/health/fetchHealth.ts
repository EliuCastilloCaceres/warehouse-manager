import { HealthDto } from '@warehouse-manager/shared';

/** Consulta /api/v1/health; lanza error ante falla de red, HTTP ≠ 2xx o respuesta inválida. */
export async function fetchHealth(): Promise<HealthDto> {
  const res = await fetch('/api/v1/health');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return HealthDto.parse(await res.json());
}
