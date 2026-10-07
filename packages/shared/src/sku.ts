import { z } from 'zod';

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,40}$/, 'El SKU debe tener de 3 a 40 caracteres: letras, números o guiones');
