import { applyBasisPoints } from '@warehouse-manager/shared';

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
 * Totales de la vista previa del ticket, en centavos (spec F5 §3). **Provisional:** F8 lo
 * reemplaza por `computeSaleTotals`, con los mismos montos.
 * - IVA incluido: `total = Σ líneas` e `iva = total − round(total × 10000 / (10000 + bp))`.
 * - Sin IVA: `iva = applyBasisPoints(subtotal, bp)` y `total = subtotal + iva`.
 */
export function previewTotals(
  lines: readonly PreviewLine[],
  taxRateBp: number,
  pricesIncludeTax: boolean,
): PreviewTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  if (pricesIncludeTax) {
    // round(total × 10000 / (10000 + bp)) con aritmética entera (medio hacia arriba).
    const divisor = BigInt(10000 + taxRateBp);
    const net = Number((BigInt(subtotal) * 10000n + divisor / 2n) / divisor);
    return { subtotal, tax: subtotal - net, total: subtotal };
  }
  const tax = applyBasisPoints(subtotal, taxRateBp);
  return { subtotal, tax, total: subtotal + tax };
}
