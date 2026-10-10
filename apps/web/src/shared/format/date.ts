/**
 * Zona por defecto de la app: `MeDto` no trae la de la sucursal. Desde F5, los módulos pasan
 * `BranchDto.timezone`.
 */
export const DEFAULT_TIME_ZONE = 'America/Mexico_City';

const LOCALE = 'es-MX';
const DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** "1 oct 2026, 23:30" en la zona indicada. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { ...DATE, ...TIME, timeZone }).format(new Date(iso));
}

/** "1 oct 2026" en la zona indicada. */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { ...DATE, timeZone }).format(new Date(iso));
}

/** "23:30" en la zona indicada. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { ...TIME, timeZone }).format(new Date(iso));
}
