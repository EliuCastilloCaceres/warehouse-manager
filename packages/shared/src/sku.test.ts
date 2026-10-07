import { normalizeSku, SkuSchema } from './index.js';

describe('SKU (T4)', () => {
  it('normalizeSku quita espacios y pasa a mayúsculas', () => {
    expect(normalizeSku(' zap01 ')).toBe('ZAP01');
  });

  it.each(['ZAP0101-25-NEG', 'A'.repeat(40)])('SkuSchema acepta %p', (sku) => {
    expect(SkuSchema.safeParse(sku).success).toBe(true);
  });

  it('SkuSchema normaliza antes de validar', () => {
    expect(SkuSchema.parse(' zap0101-25-neg ')).toBe('ZAP0101-25-NEG');
  });

  it.each(['AB', 'A'.repeat(41), 'ZAP 01', 'ZAP_01'])('SkuSchema rechaza %p', (sku) => {
    const result = SkuSchema.safeParse(sku);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'El SKU debe tener de 3 a 40 caracteres: letras, números o guiones',
    );
  });
});
