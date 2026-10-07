import { applyBasisPoints, formatMoney, MoneyCents, parseMoney } from './index.js';

describe('formatMoney (T1)', () => {
  it.each([
    [123450, '$1,234.50'],
    [0, '$0.00'],
    [5, '$0.05'],
  ])('%i → %s', (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });
});

describe('parseMoney (T2)', () => {
  it.each([
    ['1234.5', 123450],
    ['$1,234.50', 123450],
    ['1,234', 123400],
    ['0.05', 5],
  ])('%s → %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1.234', '1,23'])('%p → null', (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe('MoneyCents y applyBasisPoints (T3)', () => {
  it.each([0, 2147483647])('MoneyCents acepta %p', (value) => {
    expect(MoneyCents.safeParse(value).success).toBe(true);
  });

  it.each([1.5, -1, 2147483648])('MoneyCents rechaza %p', (value) => {
    expect(MoneyCents.safeParse(value).success).toBe(false);
  });

  it.each([
    [10000, 1600, 1600],
    [333, 1600, 53],
    [3, 5000, 2],
    [3125, 1600, 500],
  ])('applyBasisPoints(%i, %i) → %i', (amount, bp, expected) => {
    expect(applyBasisPoints(amount, bp)).toBe(expected);
  });

  it.each([
    [1.5, 1600],
    [-1, 1600],
    [100, 1.5],
    [100, -1],
  ])('applyBasisPoints(%p, %p) lanza RangeError', (amount, bp) => {
    expect(() => applyBasisPoints(amount, bp)).toThrow(RangeError);
  });
});
