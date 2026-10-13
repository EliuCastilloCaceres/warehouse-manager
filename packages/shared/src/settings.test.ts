import {
  BranchImageUrl,
  BranchUpdateInput,
  CashRegisterUpdateInput,
  isValidTimeZone,
  promoBlock,
  TaxIdSchema,
} from './index.js';

const UUID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('BranchUpdateInput (T1)', () => {
  it('un cambio parcial es válido', () => {
    expect(BranchUpdateInput.parse({ name: ' Sucursal Centro ', taxRateBp: 1600 })).toEqual({
      name: 'Sucursal Centro',
      taxRateBp: 1600,
    });
  });

  it('{} → "Debes cambiar al menos un campo"', () => {
    const result = BranchUpdateInput.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Debes cambiar al menos un campo');
  });

  it.each([
    ['code', { code: 'S9' }],
    ['currency', { currency: 'USD' }],
    ['isActive', { isActive: false }],
    ['una clave desconocida', { color: 'rojo' }],
  ])('%s → error (estricto)', (_caso, payload) => {
    const result = BranchUpdateInput.safeParse({ name: 'Centro', ...payload });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('un texto opcional con solo espacios se guarda como null', () => {
    expect(BranchUpdateInput.parse({ legalName: '   ', ticketHeader: '' })).toEqual({
      legalName: null,
      ticketHeader: null,
    });
    expect(BranchUpdateInput.parse({ taxId: '', email: '' })).toEqual({
      taxId: null,
      email: null,
    });
  });

  it.each([
    ['un correo inválido', { email: 'no-es-correo' }, 'email'],
    ['taxRateBp mayor a 10000', { taxRateBp: 10001 }, 'taxRateBp'],
    ['lowStockThreshold negativo', { lowStockThreshold: -1 }, 'lowStockThreshold'],
  ])('%s → error', (_caso, payload, path) => {
    const result = BranchUpdateInput.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([path]);
  });
});

describe('TaxIdSchema y BranchImageUrl (T2)', () => {
  it.each([
    ['xaxx010101000', 'XAXX010101000'],
    ['ABC010101AB1', 'ABC010101AB1'],
    [' ñab010101ab1 ', 'ÑAB010101AB1'],
  ])('RFC %j → %j', (value, expected) => {
    expect(TaxIdSchema.parse(value)).toBe(expected);
  });

  it.each(['ABC123', 'ABCD0101011234'])('RFC %j → error', (value) => {
    const result = TaxIdSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('RFC no válido');
  });

  it('acepta la imagen normal de sucursal y null', () => {
    expect(BranchImageUrl.safeParse(`/uploads/branch/${UUID}.webp`).success).toBe(true);
    expect(BranchImageUrl.safeParse(null).success).toBe(true);
  });

  it.each([
    ['la miniatura', `/uploads/branch/${UUID}.thumb.webp`],
    ['una imagen de producto', `/uploads/product/${UUID}.webp`],
    ['una URL externa', 'https://x.com/a.webp'],
  ])('rechaza %s', (_caso, url) => {
    const result = BranchImageUrl.safeParse(url);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Imagen no válida');
  });
});

describe('CashRegisterUpdateInput (T3)', () => {
  it('normaliza el código a mayúsculas', () => {
    expect(CashRegisterUpdateInput.parse({ code: ' c3 ' })).toEqual({ code: 'C3' });
  });

  it.each([
    ['un código con espacio', { code: 'C 3' }],
    ['un código de 11 caracteres', { code: 'C1234567890' }],
    ['un nombre vacío', { name: '  ' }],
    ['un objeto vacío', {}],
    ['branchId (estricto)', { name: 'Caja', branchId: UUID }],
  ])('%s → error', (_caso, payload) => {
    expect(CashRegisterUpdateInput.safeParse(payload).success).toBe(false);
  });
});

describe('promoBlock (T4)', () => {
  it.each([
    [
      'texto y descripción',
      { promoQrText: 'DESC10', promoQrCaption: 'Muéstralo en caja' },
      { kind: 'qr', text: 'DESC10', payload: 'PROMO:DESC10', caption: 'Muéstralo en caja' },
    ],
    [
      'solo texto',
      { promoQrText: 'DESC10', promoQrCaption: null },
      { kind: 'qr', text: 'DESC10', payload: 'PROMO:DESC10', caption: null },
    ],
    [
      'un enlace',
      { promoQrText: 'www.ejemplo.com', promoQrCaption: null },
      { kind: 'qr', text: 'www.ejemplo.com', payload: 'www.ejemplo.com', caption: null },
    ],
    [
      'solo descripción',
      { promoQrText: null, promoQrCaption: 'Síguenos en redes' },
      { kind: 'message', caption: 'Síguenos en redes' },
    ],
    ['ninguno', { promoQrText: null, promoQrCaption: null }, null],
    ['solo espacios', { promoQrText: '   ', promoQrCaption: ' ' }, null],
  ])('%s', (_caso, branch, expected) => {
    expect(promoBlock(branch)).toEqual(expected);
  });
});

describe('isValidTimeZone (T5)', () => {
  it.each([
    ['America/Mexico_City', true],
    ['America/Cancun', true],
    ['UTC', true],
    ['Mars/Phobos', false],
    ['', false],
  ])('%j → %s', (tz, expected) => {
    expect(isValidTimeZone(tz)).toBe(expected);
  });
});
