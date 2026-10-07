import { z } from 'zod';

const INT32_MAX = 2_147_483_647;

/** Dinero en centavos (entero, nunca flotante). */
export const MoneyCents = z.number().int().min(0).max(INT32_MAX);
/** Dinero en centavos que puede ser negativo (p. ej. diferencia del corte). */
export const SignedMoneyCents = z.number().int().min(-2_147_483_648).max(INT32_MAX);

/** `123450` → `"$1,234.50"`. */
export function formatMoney(cents: number, currency = 'MXN', locale = 'es-MX'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const MONEY_INPUT = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Convierte texto capturado a centavos: `$` opcional, miles con `,` solo en grupos válidos
 * y hasta 2 decimales. Devuelve `null` si la entrada es vacía, negativa o inválida.
 */
export function parseMoney(input: string): number | null {
  const match = MONEY_INPUT.exec(input.trim());
  if (!match) return null;
  const units = Number(match[1]!.replaceAll(',', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = units * 100 + cents;
  return Number.isSafeInteger(total) && total <= INT32_MAX ? total : null;
}

/** `amount × bp / 10000`, redondeado a medio hacia arriba con aritmética entera. */
export function applyBasisPoints(amount: number, bp: number): number {
  for (const value of [amount, bp]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Se esperaba un entero ≥ 0 y se recibió ${value}`);
    }
  }
  return Number((BigInt(amount) * BigInt(bp) + 5000n) / 10000n);
}
