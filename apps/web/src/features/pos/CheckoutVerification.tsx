import type { CartItemRowDto } from '@warehouse-manager/shared';
import { Check, Square } from 'lucide-react';
import { useState } from 'react';
import { NOT_A_PRODUCT_MESSAGE, PROMO_SCAN_MESSAGE } from '@/features/warehouse/components';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';

export const ALREADY_VERIFIED_MESSAGE = 'Ya verificaste todas las piezas de esta partida';
export const NOT_IN_CART_MESSAGE = 'Este producto no está en el carrito';
export const SCAN_VARIANT_MESSAGE = 'Escanea la etiqueta de la variante (talla y color)';

/** Piezas verificadas por partida (estado del cliente: no se guarda mientras se verifica). */
export type Verified = Readonly<Record<string, number>>;

/**
 * Aplica una lectura de producto (spec F8 §3): si coincide con el SKU o el código de barras de
 * una partida, suma 1 a la primera que aún no está completa. No agrega nada al carrito.
 */
export function verifyScan(
  items: readonly CartItemRowDto[],
  verified: Verified,
  code: string,
): { verified: Verified; message: string | null } {
  const matching = items.filter((item) => item.sku === code || item.barcode === code);
  if (matching.length === 0) {
    const isParent = items.some((item) => item.sku.startsWith(`${code}-`));
    return { verified, message: isParent ? SCAN_VARIANT_MESSAGE : NOT_IN_CART_MESSAGE };
  }
  const pending = matching.find((item) => (verified[item.id] ?? 0) < item.quantity);
  if (!pending) return { verified, message: ALREADY_VERIFIED_MESSAGE };
  return {
    verified: { ...verified, [pending.id]: (verified[pending.id] ?? 0) + 1 },
    message: null,
  };
}

export const verifiedUnits = (items: readonly CartItemRowDto[], verified: Verified) =>
  items.reduce((sum, item) => sum + Math.min(verified[item.id] ?? 0, item.quantity), 0);

/** "Verificar piezas (opcional)": escáner, lista palomeada y "1 de 2 piezas verificadas". */
export function CheckoutVerification({
  items,
  verified,
  onChange,
}: {
  items: readonly CartItemRowDto[];
  verified: Verified;
  onChange: (verified: Verified) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  const onScan = (scan: ValidScan) => {
    if (scan.kind !== 'product') {
      setMessage(scan.kind === 'promo' ? PROMO_SCAN_MESSAGE : NOT_A_PRODUCT_MESSAGE);
      return;
    }
    const result = verifyScan(items, verified, scan.code);
    setMessage(result.message);
    if (result.verified !== verified) onChange(result.verified);
  };

  return (
    <section aria-label="Verificar piezas" className="flex flex-col gap-2">
      <ScanInput
        label="Verificar piezas (opcional)"
        placeholder="Escanea las piezas"
        captureHid
        continuous
        onScan={onScan}
      />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <ul aria-label="Piezas del carrito" className="flex flex-col gap-1">
        {items.map((item) => {
          const done = verified[item.id] ?? 0;
          const complete = done >= item.quantity;
          const name = item.variantLabel
            ? `${item.productName} ${item.variantLabel}`
            : item.productName;
          return (
            <li
              key={item.id}
              aria-label={`${name}: ${done} de ${item.quantity}${complete ? ', verificada' : ''}`}
              className="flex items-center gap-2 text-sm"
            >
              {complete ? (
                <Check aria-hidden className="size-4 text-green-600" />
              ) : (
                <Square aria-hidden className="size-4 text-muted-foreground" />
              )}
              <span className="flex-1">{name}</span>
              <span className="tabular-nums">
                {done} de {item.quantity}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm font-medium">
        {verifiedUnits(items, verified)} de {units} piezas verificadas
      </p>
    </section>
  );
}
