import { computeSaleTotals } from '@warehouse-manager/shared';

export interface PreviewLine {
  unitPrice: number;
  quantity: number;
}

export interface PreviewTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Totales de la vista previa del ticket, en centavos. Delega en `computeSaleTotals` (spec F8 §1),
 * la misma regla del cobro, con partidas sin descuento:
 * - IVA incluido: `total = Σ líneas` e `iva = total − round(total × 10000 / (10000 + bp))`.
 * - Sin IVA: `iva = applyBasisPoints(subtotal, bp)` y `total = subtotal + iva`.
 */
export function previewTotals(
  lines: readonly PreviewLine[],
  taxRateBp: number,
  pricesIncludeTax: boolean,
): PreviewTotals {
  const totals = computeSaleTotals({
    lines: lines.map((line) => ({ ...line, discount: 0 })),
    globalDiscount: 0,
    taxRateBp,
    pricesIncludeTax,
  });
  return { subtotal: totals.subtotal, tax: totals.taxTotal, total: totals.total };
}
