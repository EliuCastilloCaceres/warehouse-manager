import { z } from 'zod';

export const STAGING_ZONE_CODE = 'STG';
export const LOCATION_QR_PREFIX = 'LOC:';

const ZONE = /^([A-Z]{1,2}|STG)$/;
const SEGMENT = /^(0[1-9]|[1-9][0-9])$/;
const LOCATION = /^([A-Z]{1,2}|STG)-(0[1-9]|[1-9][0-9])-(0[1-9]|[1-9][0-9])$/;

export const ZoneCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ZONE, 'La zona debe tener 1 o 2 letras (o STG)');
export const SegmentCodeSchema = z.string().regex(SEGMENT, 'Debe ser un número de 01 a 99');
export const LocationCodeSchema = z.string().regex(LOCATION, 'Código de ubicación inválido');

export interface LocationParts {
  zone: string;
  container: string;
  rack: string;
}

/** `{ zone: 'A', container: '01', rack: '03' }` → `"A-01-03"`. Lanza error si algún segmento es inválido. */
export function buildLocationCode({ zone, container, rack }: LocationParts): string {
  const z1 = ZoneCodeSchema.safeParse(zone);
  const c1 = SegmentCodeSchema.safeParse(container);
  const r1 = SegmentCodeSchema.safeParse(rack);
  if (!z1.success || !c1.success || !r1.success) {
    throw new Error(`Segmentos de ubicación inválidos: ${zone}-${container}-${rack}`);
  }
  return `${z1.data}-${c1.data}-${r1.data}`;
}

/** Normaliza un segmento de 1–2 dígitos a 2 dígitos; `null` si es 0, 00 o tiene más de 2 dígitos. */
function normalizeSegment(raw: string): string | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const padded = raw.padStart(2, '0');
  return SEGMENT.test(padded) ? padded : null;
}

/**
 * Lee un código de ubicación tolerando captura manual (`"a-1-3"` → `A-01-03`).
 * Devuelve `null` si no es válido.
 */
export function parseLocationCode(raw: string): (LocationParts & { code: string }) | null {
  const parts = raw.trim().toUpperCase().split('-');
  if (parts.length !== 3) return null;
  const [zone, containerRaw, rackRaw] = parts as [string, string, string];
  if (!ZONE.test(zone)) return null;
  const container = normalizeSegment(containerRaw);
  const rack = normalizeSegment(rackRaw);
  if (!container || !rack) return null;
  return { zone, container, rack, code: `${zone}-${container}-${rack}` };
}

/** `"A-01-03"` → `"LOC:A-01-03"`. */
export function toLocationQr(code: string): string {
  return `${LOCATION_QR_PREFIX}${code}`;
}
