import { normalizeSku, SkuSchema, suggestVariantSku } from './index.js';

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

describe('suggestVariantSku (T1 de F6)', () => {
  it.each([
    ['ZAP0101', { size: '25.5', color: 'Negro' }, 'ZAP0101-255-NEG'],
    ['ZAP0101', { size: '23', color: 'Café' }, 'ZAP0101-23-CAF'],
    ['BOL0201', { color: 'Rojo' }, 'BOL0201-ROJ'],
    ['ZAP0101', { size: '25', color: 'Negro', material: 'Piel' }, 'ZAP0101-25-NEG-PIE'],
    ['ZAP0101', { size: 'xl' }, 'ZAP0101-XL'],
    [' zap0101 ', { size: null, color: ' azul marino ' }, 'ZAP0101-AZU'],
    ['ZAP0101', {}, null],
    ['ZAP0101', { size: ' ', color: '' }, null],
    ['A'.repeat(36), { size: '25', color: 'Negro' }, null],
  ])('%j + %j → %j', (parent, attrs, expected) => {
    expect(suggestVariantSku(parent, attrs)).toBe(expected);
  });
});
