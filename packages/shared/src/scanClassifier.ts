import { LOCATION_QR_PREFIX, parseLocationCode } from './locationCode.js';
import { normalizeSku, SkuSchema } from './sku.js';

export const PROMO_QR_PREFIX = 'PROMO:';

export type ScanResult =
  | { kind: 'location'; code: string } // canónico, p. ej. "A-01-03"
  | { kind: 'product'; code: string } // SKU o código de barras normalizado
  | { kind: 'promo'; text: string } // QR de promoción del ticket (F5)
  | { kind: 'invalid'; raw: string };

/** Enlace (`http://`, `https://` o `www.`), sin distinguir mayúsculas. */
export function isUrlLike(text: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(text);
}

/** Contenido del QR de promoción: un enlace va tal cual; cualquier otro texto, con `PROMO:`. */
export function toPromoQrPayload(text: string): string {
  return isUrlLike(text) ? text : `${PROMO_QR_PREFIX}${text}`;
}

function startsWithIgnoreCase(text: string, prefix: string): boolean {
  return text.slice(0, prefix.length).toUpperCase() === prefix;
}

// Espacios y caracteres de control (\r, \n, \t…) que suelen agregar los lectores HID.
// eslint-disable-next-line no-control-regex
const EDGE_JUNK = /^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g;

/** Clasifica una lectura de escáner o captura manual. */
export function classifyScan(raw: string): ScanResult {
  const text = raw.replace(EDGE_JUNK, '');

  if (startsWithIgnoreCase(text, LOCATION_QR_PREFIX)) {
    const location = parseLocationCode(text.slice(LOCATION_QR_PREFIX.length));
    return location ? { kind: 'location', code: location.code } : { kind: 'invalid', raw };
  }

  if (startsWithIgnoreCase(text, PROMO_QR_PREFIX)) {
    const rest = text.slice(PROMO_QR_PREFIX.length);
    return rest.trim() ? { kind: 'promo', text: rest } : { kind: 'invalid', raw };
  }

  if (isUrlLike(text)) {
    return { kind: 'promo', text };
  }

  const sku = SkuSchema.safeParse(normalizeSku(text));
  return sku.success ? { kind: 'product', code: sku.data } : { kind: 'invalid', raw };
}
