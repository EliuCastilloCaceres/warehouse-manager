import { previewTotals } from './previewTotals';

const LINES = [
  { unitPrice: 89900, quantity: 1 },
  { unitPrice: 34900, quantity: 1 },
];

describe('previewTotals (T23)', () => {
  it('con IVA incluido: total 124800 e IVA 17214', () => {
    expect(previewTotals(LINES, 1600, true)).toEqual({
      subtotal: 124800,
      tax: 17214,
      total: 124800,
    });
  });

  it('sin IVA incluido: subtotal 124800, IVA 19968 y total 144768', () => {
    expect(previewTotals(LINES, 1600, false)).toEqual({
      subtotal: 124800,
      tax: 19968,
      total: 144768,
    });
  });

  it.each([true, false])('con 0 bp el IVA es 0 (incluido: %s)', (included) => {
    expect(previewTotals(LINES, 0, included)).toEqual({ subtotal: 124800, tax: 0, total: 124800 });
  });

  it('multiplica por la cantidad', () => {
    expect(previewTotals([{ unitPrice: 1000, quantity: 3 }], 1600, false).subtotal).toBe(3000);
  });
});
