import { STRUCTURE_SEGMENT_MAX } from '@warehouse-manager/shared';
import { DomainError } from '../../core/errors.js';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** Códigos de zona en orden: A…Z, AA…ZZ. */
const ZONE_SEQUENCE = [...LETTERS, ...LETTERS.flatMap((a) => LETTERS.map((b) => a + b))];

/** Códigos de contenedor o rack en orden: 01…99. */
const SEGMENT_SEQUENCE = Array.from({ length: STRUCTURE_SEGMENT_MAX }, (_, i) =>
  String(i + 1).padStart(2, '0'),
);

/**
 * Siguientes `count` códigos después del último usado. Si no caben y es uno solo, toma el
 * primer hueco libre; si no, `null`.
 */
function nextCodes(sequence: string[], used: readonly string[], count: number): string[] | null {
  const taken = new Set(used);
  const last = Math.max(-1, ...used.map((code) => sequence.indexOf(code)));
  const following = sequence.slice(last + 1, last + 1 + count);
  if (following.length === count) return following;
  if (count === 1) {
    const gap = sequence.find((code) => !taken.has(code));
    if (gap) return [gap];
  }
  return null;
}

export function nextZoneCode(used: readonly string[]): string {
  const [code] = nextCodes(ZONE_SEQUENCE, used, 1) ?? [];
  if (!code) {
    throw new DomainError('STRUCTURE_FULL', { message: 'Se alcanzó el máximo de zonas.' });
  }
  return code;
}

/** Códigos de contenedor o rack que siguen al último usado; si pasarían de `99` → `STRUCTURE_FULL`. */
export function nextSegmentCodes(used: readonly string[], count: number): string[] {
  const codes = nextCodes(SEGMENT_SEQUENCE, used, count);
  if (!codes) throw new DomainError('STRUCTURE_FULL');
  return codes;
}
