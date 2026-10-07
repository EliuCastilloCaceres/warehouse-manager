import { classifyScan, toPromoQrPayload, type ScanResult } from './index.js';

describe('classifyScan (T7)', () => {
  it.each<[string, ScanResult]>([
    ['LOC:A-01-03', { kind: 'location', code: 'A-01-03' }],
    ['loc:a-1-3\r\n', { kind: 'location', code: 'A-01-03' }],
    [' zap0101-25-neg\t', { kind: 'product', code: 'ZAP0101-25-NEG' }],
    ['7501234567890', { kind: 'product', code: '7501234567890' }],
    ['LOC:XYZ', { kind: 'invalid', raw: 'LOC:XYZ' }],
    ['', { kind: 'invalid', raw: '' }],
    ['ZAP 01', { kind: 'invalid', raw: 'ZAP 01' }],
    ['PROMO:DESC10', { kind: 'promo', text: 'DESC10' }],
    ['promo:desc10\r\n', { kind: 'promo', text: 'desc10' }],
    ['PROMO:', { kind: 'invalid', raw: 'PROMO:' }],
    ['https://ejemplo.com/x', { kind: 'promo', text: 'https://ejemplo.com/x' }],
    ['WWW.EJEMPLO.COM', { kind: 'promo', text: 'WWW.EJEMPLO.COM' }],
  ])('%p → %o', (raw, expected) => {
    expect(classifyScan(raw)).toEqual(expected);
  });
});

describe('toPromoQrPayload (T26)', () => {
  it.each([
    ['DESC10', 'PROMO:DESC10'],
    ['https://ejemplo.com', 'https://ejemplo.com'],
    ['http://x.mx', 'http://x.mx'],
    ['www.ejemplo.com', 'www.ejemplo.com'],
  ])('%p → %p', (text, payload) => {
    expect(toPromoQrPayload(text)).toBe(payload);
  });

  it.each(['DESC10', 'www.ejemplo.com'])('classifyScan(toPromoQrPayload(%p)) es promo', (text) => {
    expect(classifyScan(toPromoQrPayload(text))).toEqual({ kind: 'promo', text });
  });
});
