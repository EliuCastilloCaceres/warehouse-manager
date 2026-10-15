import type { LocationLabelDto } from '@warehouse-manager/shared';
import type { PrintSize } from '@/shared/print/PrintLayout';
import { QrCode } from '@/shared/print/QrCode';

/** Cada formato es también su tamaño de impresión (`PrintLayout`). */
export type LocationLabelFormat = Extract<PrintSize, 'label-4x6' | 'label-50x25' | 'a4' | 'letter'>;

export const LOCATION_LABEL_FORMATS: readonly (readonly [LocationLabelFormat, string])[] = [
  ['label-4x6', '4×6"'],
  ['label-50x25', '50×25 mm'],
  ['a4', 'Hoja A4'],
  ['letter', 'Hoja Carta'],
];

/** Etiquetas por hoja A4 o Carta: 2 columnas × 5 filas (spec F7 §3). */
export const LOCATION_LABELS_PER_SHEET = 10;

const capacityText = (label: LocationLabelDto) =>
  label.isStaging ? 'Sin límite' : `Capacidad ${label.capacityUnits}`;

/** 4×6" (térmica): QR grande, código muy grande, franja negra con el color, zona y capacidad. */
export function LocationLabel4x6({ label }: { label: LocationLabelDto }) {
  return (
    <div
      data-label="label-4x6"
      className="flex h-full flex-col items-center gap-[3mm] bg-white p-[6mm] text-center text-black"
    >
      <span data-code="qr" className="w-[70mm]">
        <QrCode value={label.qrPayload} className="w-full" />
      </span>
      <p className="font-mono text-[18mm] leading-none font-bold">{label.locationCode}</p>
      {label.colorName && (
        <p
          data-band="black"
          className="w-full bg-black py-[2mm] text-[9mm] font-bold tracking-widest text-white uppercase"
        >
          {label.colorName}
        </p>
      )}
      <p className="text-[7mm]">{label.zoneName}</p>
      <p className="text-[6mm]">{capacityText(label)}</p>
    </div>
  );
}

/** 50×25 mm (térmica): QR y código. */
export function LocationLabel50x25({ label }: { label: LocationLabelDto }) {
  return (
    <div
      data-label="label-50x25"
      className="flex h-full items-center gap-[2mm] bg-white p-[1.5mm] text-black"
    >
      <span data-code="qr" className="h-full shrink-0">
        <QrCode value={label.qrPayload} className="h-full" />
      </span>
      <p className="font-mono text-[6mm] leading-none font-bold">{label.locationCode}</p>
    </div>
  );
}

/** Celda de hoja (2×5): QR, código, zona, capacidad y banda en su color real. */
export function SheetLocationLabel({ label }: { label: LocationLabelDto }) {
  return (
    <div data-label="sheet" className="flex h-full flex-col overflow-hidden border border-dashed">
      {label.colorHex && (
        <div
          data-band="color"
          className="flex h-[8mm] items-center justify-center text-[4mm] font-bold text-white"
          style={{ backgroundColor: label.colorHex }}
        >
          {label.colorName}
        </div>
      )}
      <div className="flex flex-1 items-center gap-[3mm] p-[3mm] text-black">
        <span data-code="qr" className="h-[30mm] shrink-0">
          <QrCode value={label.qrPayload} className="h-full" />
        </span>
        <div className="flex flex-col">
          <p className="font-mono text-[9mm] leading-none font-bold">{label.locationCode}</p>
          <p className="text-[4mm]">{label.zoneName}</p>
          <p className="text-[3.5mm]">{capacityText(label)}</p>
        </div>
      </div>
    </div>
  );
}

/** Hoja A4 o Carta con hasta 10 etiquetas en una cuadrícula de 2×5. */
export function LocationLabelSheet({
  labels,
  format,
}: {
  labels: readonly LocationLabelDto[];
  format: 'a4' | 'letter';
}) {
  return (
    <div
      data-testid="location-sheet"
      className="grid grid-cols-2 grid-rows-5 gap-[4mm] bg-white p-[10mm] break-after-page"
      style={
        format === 'a4' ? { width: '210mm', height: '297mm' } : { width: '8.5in', height: '11in' }
      }
    >
      {labels.map((label) => (
        <SheetLocationLabel key={label.rackId} label={label} />
      ))}
    </div>
  );
}
