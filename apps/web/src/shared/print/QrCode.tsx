import { type BitMatrix, create } from 'qrcode';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { INVALID_BARCODE_MESSAGE } from './Barcode';

/** Margen blanco alrededor del QR, en módulos (la norma pide 4; en etiquetas chicas basta con 2). */
const QUIET_ZONE = 2;

interface Run {
  x: number;
  y: number;
  width: number;
}

/** Recorre la matriz por filas y une los módulos oscuros contiguos en un solo `<rect>`. */
function darkRuns(value: string): { size: number; runs: Run[] } | null {
  let modules: BitMatrix;
  try {
    modules = create(value, { errorCorrectionLevel: 'M' }).modules;
  } catch {
    return null;
  }
  const runs: Run[] = [];
  for (let y = 0; y < modules.size; y++) {
    let start = -1;
    for (let x = 0; x <= modules.size; x++) {
      const dark = x < modules.size && modules.get(y, x);
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push({ x: start, y, width: x - start });
        start = -1;
      }
    }
  }
  return { size: modules.size, runs };
}

/** QR (corrección M) armado con `<rect>` desde la matriz de `qrcode`, sin `innerHTML`. */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const qr = useMemo(() => (value ? darkRuns(value) : null), [value]);
  if (!qr) return <span className="text-sm text-destructive">{INVALID_BARCODE_MESSAGE}</span>;

  const side = qr.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={value}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      className={cn('aspect-square', className)}
    >
      <rect width={side} height={side} fill="#fff" />
      {qr.runs.map((run) => (
        <rect
          key={`${run.y}-${run.x}`}
          x={run.x + QUIET_ZONE}
          y={run.y + QUIET_ZONE}
          width={run.width}
          height={1}
          fill="#000"
        />
      ))}
    </svg>
  );
}
