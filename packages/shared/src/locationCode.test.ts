import {
  buildLocationCode,
  LocationCodeSchema,
  parseLocationCode,
  SegmentCodeSchema,
  toLocationQr,
  ZoneCodeSchema,
} from './index.js';

describe('buildLocationCode (T5)', () => {
  it.each([
    [{ zone: 'A', container: '01', rack: '03' }, 'A-01-03'],
    [{ zone: 'AB', container: '12', rack: '99' }, 'AB-12-99'],
    [{ zone: 'STG', container: '01', rack: '01' }, 'STG-01-01'],
  ])('%o → %s', (parts, expected) => {
    expect(buildLocationCode(parts)).toBe(expected);
    expect(LocationCodeSchema.safeParse(expected).success).toBe(true);
  });

  it.each([
    { zone: 'ABC', container: '01', rack: '01' },
    { zone: 'A', container: '00', rack: '01' },
    { zone: 'A', container: '01', rack: '100' },
  ])('lanza error con %o', (parts) => {
    expect(() => buildLocationCode(parts)).toThrow();
  });

  it('los esquemas de segmento normalizan la zona y exigen 2 dígitos', () => {
    expect(ZoneCodeSchema.parse(' stg ')).toBe('STG');
    expect(SegmentCodeSchema.safeParse('1').success).toBe(false);
  });
});

describe('parseLocationCode y toLocationQr (T6)', () => {
  it.each([
    ['A-01-03', 'A-01-03'],
    ['AB-12-99', 'AB-12-99'],
    ['a-1-3', 'A-01-03'],
    [' stg-1-1 ', 'STG-01-01'],
  ])('%p → %s', (raw, code) => {
    expect(parseLocationCode(raw)?.code).toBe(code);
  });

  it('devuelve los segmentos', () => {
    expect(parseLocationCode('a-1-3')).toEqual({
      zone: 'A',
      container: '01',
      rack: '03',
      code: 'A-01-03',
    });
  });

  it.each(['A-00-01', 'A-100-01', 'ABC-01-01', 'A01-03', ''])('%p → null', (raw) => {
    expect(parseLocationCode(raw)).toBeNull();
  });

  it('toLocationQr agrega el prefijo LOC:', () => {
    expect(toLocationQr('A-01-03')).toBe('LOC:A-01-03');
  });
});
