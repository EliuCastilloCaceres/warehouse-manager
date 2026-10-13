import { z } from 'zod';

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,40}$/, 'El SKU debe tener de 3 a 40 caracteres: letras, números o guiones');

const SKU_MAX = 40;

/** Sin acentos, en mayúsculas y solo `[A-Z0-9]`: `"Café"` → `"CAFE"`, `"25.5"` → `"255"`. */
function skuPart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * SKU sugerido de una variante (spec F6 §3): `{PADRE}[-{TALLA}][-{COLOR3}][-{MATERIAL3}]`.
 * La talla completa (`25.5` → `255`); color y material, sus 3 primeras letras (`Café` → `CAF`).
 * Sin atributos, o si pasa de 40 caracteres → `null` (lo escribe el usuario).
 */
export function suggestVariantSku(
  parentSku: string,
  attrs: { size?: string | null; color?: string | null; material?: string | null },
): string | null {
  const parts = [
    skuPart(attrs.size),
    skuPart(attrs.color).slice(0, 3),
    skuPart(attrs.material).slice(0, 3),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const sku = [normalizeSku(parentSku), ...parts].join('-');
  return sku.length <= SKU_MAX ? sku : null;
}
