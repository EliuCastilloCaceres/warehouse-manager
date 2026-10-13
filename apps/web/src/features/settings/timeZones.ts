/** Zonas de México, que la UI ofrece primero (spec F5 §3). */
export const MEXICO_TIME_ZONES = [
  'America/Mexico_City',
  'America/Cancun',
  'America/Merida',
  'America/Monterrey',
  'America/Chihuahua',
  'America/Hermosillo',
  'America/Mazatlan',
  'America/Tijuana',
] as const;

/** El resto de las zonas que conoce el navegador, más la actual si no está en ninguna lista. */
export function otherTimeZones(current: string): string[] {
  const mexico: readonly string[] = MEXICO_TIME_ZONES;
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const others = all.filter((tz) => !mexico.includes(tz));
  if (current && !mexico.includes(current) && !others.includes(current)) others.unshift(current);
  return others;
}
