import { MEXICO_TIME_ZONES, otherTimeZones } from './timeZones';

describe('otherTimeZones', () => {
  it('no repite las de México y agrega la actual si el navegador no la lista', () => {
    const others = otherTimeZones('America/Mexico_City');
    for (const tz of MEXICO_TIME_ZONES) expect(others).not.toContain(tz);
    expect(others).toContain('Europe/Madrid');
    expect(otherTimeZones('Zona/Guardada')[0]).toBe('Zona/Guardada');
  });

  it('sin Intl.supportedValuesOf solo ofrece la actual', () => {
    const original = Intl.supportedValuesOf;
    Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined, configurable: true });
    try {
      expect(otherTimeZones('UTC')).toEqual(['UTC']);
      expect(otherTimeZones('America/Cancun')).toEqual([]);
    } finally {
      Object.defineProperty(Intl, 'supportedValuesOf', { value: original, configurable: true });
    }
  });
});
