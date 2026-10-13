import { formatMoney, type LabelDataDto } from '@warehouse-manager/shared';
import { Barcode } from '@/shared/print/Barcode';
import type { PrintSize } from '@/shared/print/PrintLayout';
import { QrCode } from '@/shared/print/QrCode';

/** Cada formato es también su tamaño de impresión (`PrintLayout`). */
export type LabelFormat = Extract<PrintSize, 'label-50x25' | 'label-4x6' | 'a4' | 'letter'>;

export const LABEL_FORMATS: readonly (readonly [LabelFormat, string])[] = [
  ['label-50x25', '50×25 mm'],
  ['label-4x6', '4×6"'],
  ['a4', 'Hoja A4 (24 por hoja)'],
  ['letter', 'Hoja Carta (24 por hoja)'],
];

/** Etiquetas por hoja A4 o Carta: 3 columnas × 8 filas (spec F6 §3). */
export const LABELS_PER_SHEET = 24;

interface LabelProps {
  label: LabelDataDto;
  showPrice: boolean;
}

const price = (label: LabelDataDto) => formatMoney(label.price);

/** 50×25 mm: sin imagen, QR del SKU (sin prefijo: `classifyScan` lo lee como producto). */
export function Label50x25({ label, showPrice }: LabelProps) {
  return (
    <div
      data-label="label-50x25"
      className="flex h-full items-center gap-[1.5mm] bg-white p-[1.5mm] text-black"
    >
      <span data-code="qr" className="h-full shrink-0">
        <QrCode value={label.sku} className="h-full" />
      </span>
      <div className="flex min-w-0 flex-col text-[2.6mm] leading-tight">
        <p className="line-clamp-2 font-bold">{label.productName}</p>
        {label.variantLabel && <p>{label.variantLabel}</p>}
        {showPrice && <p className="font-bold">{price(label)}</p>}
        <p className="font-mono text-[2.3mm] break-all">{label.sku}</p>
      </div>
    </div>
  );
}

/** 4×6": imagen, nombre, variante, precio opcional y Code128 grande. */
export function Label4x6({ label, showPrice }: LabelProps) {
  return (
    <div
      data-label="label-4x6"
      className="flex h-full flex-col items-center gap-[3mm] bg-white p-[6mm] text-center text-black"
    >
      {label.thumbUrl && (
        <img src={label.thumbUrl} alt={label.productName} className="max-h-[45mm] object-contain" />
      )}
      <p className="text-[7mm] leading-tight font-bold">{label.productName}</p>
      {label.variantLabel && <p className="text-[5mm]">{label.variantLabel}</p>}
      {showPrice && <p className="text-[8mm] font-bold">{price(label)}</p>}
      <span data-code="barcode" className="mt-auto w-full">
        <Barcode value={label.sku} height={90} fontSize={20} className="w-full" />
      </span>
    </div>
  );
}

/** Etiqueta de hoja (3×8): imagen pequeña, nombre, variante, precio opcional y Code128. */
export function SheetLabel({ label, showPrice }: LabelProps) {
  return (
    <div
      data-label="sheet"
      className="flex h-full items-center gap-[2mm] overflow-hidden p-[2mm] text-black"
    >
      {label.thumbUrl && (
        <img
          src={label.thumbUrl}
          alt={label.productName}
          className="size-[14mm] shrink-0 object-contain"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col text-[2.8mm] leading-tight">
        <p className="line-clamp-2 font-bold">{label.productName}</p>
        {label.variantLabel && <p>{label.variantLabel}</p>}
        {showPrice && <p className="font-bold">{price(label)}</p>}
        <span data-code="barcode">
          <Barcode value={label.sku} height={28} fontSize={10} className="w-full" />
        </span>
      </div>
    </div>
  );
}

/** Hoja A4 o Carta con hasta 24 etiquetas en una cuadrícula de 3×8. */
export function LabelSheet({
  labels,
  format,
  showPrice,
}: {
  labels: readonly LabelDataDto[];
  format: 'a4' | 'letter';
  showPrice: boolean;
}) {
  return (
    <div
      data-testid="label-sheet"
      className="grid grid-cols-3 grid-rows-8 bg-white p-[8mm] break-after-page"
      style={
        format === 'a4' ? { width: '210mm', height: '297mm' } : { width: '8.5in', height: '11in' }
      }
    >
      {labels.map((label, i) => (
        <SheetLabel key={i} label={label} showPrice={showPrice} />
      ))}
    </div>
  );
}

/** Una copia por unidad: `quantity: 3` → 3 etiquetas. */
export function expandLabels(labels: readonly LabelDataDto[]): LabelDataDto[] {
  return labels.flatMap((label) => Array.from({ length: label.quantity }, () => label));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}
