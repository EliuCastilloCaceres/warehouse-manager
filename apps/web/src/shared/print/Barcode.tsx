import JsBarcode from 'jsbarcode';
import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export const INVALID_BARCODE_MESSAGE = 'Código inválido';

/** Code128 admite ASCII; en etiquetas solo tienen sentido los caracteres imprimibles. */
export function isValidCode128(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value);
}

export interface BarcodeProps {
  value: string;
  /** Alto de las barras, en unidades del SVG. */
  height?: number;
  /** Ancho del módulo más delgado, en unidades del SVG. */
  barWidth?: number;
  fontSize?: number;
  className?: string;
}

/**
 * Code128 en `<svg>` con el texto visible. El SVG trae `viewBox`, así que escala con CSS
 * (p. ej. `w-full`) sin perder nitidez al imprimir.
 */
export function Barcode({
  value,
  height = 50,
  barWidth = 2,
  fontSize = 14,
  className,
}: BarcodeProps) {
  const ref = useRef<SVGSVGElement>(null);
  const valid = isValidCode128(value);

  useLayoutEffect(() => {
    if (!valid || !ref.current) return;
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      displayValue: true,
      height,
      width: barWidth,
      fontSize,
      margin: 0,
      background: 'transparent',
    });
  }, [valid, value, height, barWidth, fontSize]);

  if (!valid) return <span className="text-sm text-destructive">{INVALID_BARCODE_MESSAGE}</span>;
  return (
    <svg ref={ref} role="img" aria-label={value} className={cn('h-auto max-w-full', className)} />
  );
}
