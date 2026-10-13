import { z } from 'zod';
import { BasisPoints, NonNegativeInt } from './common.js';
import { toPromoQrPayload } from './scanClassifier.js';

/** Texto opcional: se recorta y la cadena vacía se guarda como `null` (vaciar el campo lo borra). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** RFC: 12 caracteres (persona moral) o 13 (persona física), sin validar el dígito verificador. */
export const TaxIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/, 'RFC no válido');

/** Solo la imagen normal subida con `POST /uploads/branch-images` (no la miniatura). */
export const BranchImageUrl = z
  .string()
  .regex(/^\/uploads\/branch\/[0-9a-f-]{36}\.webp$/, 'Imagen no válida')
  .nullable();

/** `true` si `Intl` reconoce la zona horaria (IANA), p. ej. `America/Mexico_City`. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z.string().refine(isValidTimeZone, 'Zona horaria no válida');

export const BranchUpdateInput = z
  .strictObject({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120).optional(),
    legalName: optionalText(200).optional(),
    taxId: z
      .union([TaxIdSchema, z.literal('').transform(() => null)])
      .nullable()
      .optional(),
    address: optionalText(300).optional(),
    phone: optionalText(30).optional(),
    email: z
      .union([z.email('Correo no válido'), z.literal('').transform(() => null)])
      .nullable()
      .optional(),
    imageUrl: BranchImageUrl.optional(),
    logoUrl: BranchImageUrl.optional(),
    ticketHeader: optionalText(500).optional(),
    ticketFooterMessage: optionalText(500).optional(),
    promoQrText: optionalText(300).optional(),
    promoQrCaption: optionalText(200).optional(),
    timezone: TimeZoneSchema.optional(),
    taxRateBp: BasisPoints.optional(),
    pricesIncludeTax: z.boolean().optional(),
    lowStockThreshold: NonNegativeInt.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });
export type BranchUpdateInput = z.infer<typeof BranchUpdateInput>;

export const CashRegisterCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9-]{1,10}$/,
    'El código debe tener de 1 a 10 caracteres: letras, números o guiones',
  );

export const CashRegisterUpdateInput = z
  .strictObject({
    code: CashRegisterCodeSchema.optional(),
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });
export type CashRegisterUpdateInput = z.infer<typeof CashRegisterUpdateInput>;

export type PromoBlock =
  | { kind: 'qr'; text: string; payload: string; caption: string | null }
  | { kind: 'message'; caption: string }
  | null;

/**
 * Qué imprime el ticket (spec F5 §8.1): con texto, el QR (`payload` = `toPromoQrPayload(text)`)
 * y la descripción debajo si existe; solo descripción, un mensaje sin QR; ninguno, nada.
 */
export function promoBlock(b: {
  promoQrText: string | null;
  promoQrCaption: string | null;
}): PromoBlock {
  const text = b.promoQrText?.trim() || null;
  const caption = b.promoQrCaption?.trim() || null;
  if (text) return { kind: 'qr', text, payload: toPromoQrPayload(text), caption };
  if (caption) return { kind: 'message', caption };
  return null;
}
