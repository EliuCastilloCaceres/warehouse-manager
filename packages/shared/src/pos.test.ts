import {
  CartDetailDto,
  CartItemUpdateInput,
  CartUpdateInput,
  CashSessionSummaryDto,
  CheckoutInput,
  computeChange,
  computeSaleTotals,
  formatFolio,
  OpenSessionInput,
  PAYMENT_METHOD_LABELS,
  PaymentInput,
  PaymentMethod,
  PosRegisterDto,
  SaleCancelInput,
  SaleTicketDto,
} from './index.js';

const UUID = (n: number) => `9a8b7c6d-5e4f-4a3b-8c2d-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-15T15:00:00.000Z';
const stamps = { createdAt: NOW, updatedAt: NOW };

const pathsOf = (
  schema: { safeParse: (v: unknown) => { error?: { issues: { path: PropertyKey[] }[] } } },
  input: unknown,
) => schema.safeParse(input).error?.issues.map((i) => i.path.join('.')) ?? [];

const line = (unitPrice: number, discount = 0, quantity = 1) => ({ unitPrice, quantity, discount });

describe('computeSaleTotals (T1)', () => {
  it.each([
    {
      caso: 'IVA incluido',
      lines: [line(89900), line(34900)],
      globalDiscount: 0,
      pricesIncludeTax: true,
      taxRateBp: 1600,
      expected: { subtotal: 124800, discountTotal: 0, taxTotal: 17214, total: 124800 },
    },
    {
      caso: 'sin IVA incluido',
      lines: [line(89900), line(34900)],
      globalDiscount: 0,
      pricesIncludeTax: false,
      taxRateBp: 1600,
      expected: { subtotal: 124800, discountTotal: 0, taxTotal: 19968, total: 144768 },
    },
    {
      caso: 'descuento de partida y global, IVA incluido',
      lines: [line(89900, 10000), line(34900)],
      globalDiscount: 4800,
      pricesIncludeTax: true,
      taxRateBp: 1600,
      expected: {
        subtotal: 124800,
        lineDiscounts: 10000,
        globalDiscount: 4800,
        discountTotal: 14800,
        taxTotal: 15172,
        total: 110000,
      },
    },
    {
      caso: 'descuentos sin IVA incluido',
      lines: [line(89900, 10000), line(34900)],
      globalDiscount: 4800,
      pricesIncludeTax: false,
      taxRateBp: 1600,
      expected: { discountTotal: 14800, taxTotal: 17600, total: 127600 },
    },
    {
      caso: '0 bp',
      lines: [line(89900), line(34900)],
      globalDiscount: 0,
      pricesIncludeTax: false,
      taxRateBp: 0,
      expected: { taxTotal: 0, total: 124800 },
    },
    {
      caso: 'cantidades y total 0',
      lines: [line(10000, 20000, 2)],
      globalDiscount: 0,
      pricesIncludeTax: true,
      taxRateBp: 1600,
      expected: { subtotal: 20000, discountTotal: 20000, taxTotal: 0, total: 0 },
    },
  ])('$caso', ({ lines, globalDiscount, pricesIncludeTax, taxRateBp, expected }) => {
    const totals = computeSaleTotals({ lines, globalDiscount, pricesIncludeTax, taxRateBp });
    expect(totals).toMatchObject(expected);
    expect(totals.total).toBe(
      totals.subtotal - totals.discountTotal + (pricesIncludeTax ? 0 : totals.taxTotal),
    );
    expect(totals.discountTotal).toBe(totals.lineDiscounts + totals.globalDiscount);
  });

  it.each([
    ['global mayor que las partidas', [line(10000, 1000)], 9001],
    ['descuento de partida mayor que su importe', [line(10000, 10001)], 0],
    ['monto decimal', [line(100.5)], 0],
    ['cantidad negativa', [line(100, 0, -1)], 0],
    ['global decimal', [line(10000)], 0.5],
  ])('%s → RangeError', (_caso, lines, globalDiscount) => {
    expect(() =>
      computeSaleTotals({ lines, globalDiscount, taxRateBp: 1600, pricesIncludeTax: true }),
    ).toThrow(RangeError);
  });

  it('una tasa de IVA no entera → RangeError', () => {
    expect(() =>
      computeSaleTotals({ lines: [], globalDiscount: 0, taxRateBp: 16.5, pricesIncludeTax: true }),
    ).toThrow(RangeError);
  });
});

describe('PaymentInput, CheckoutInput y computeChange (T2)', () => {
  const cash = { method: 'CASH', amount: 124800, received: 130000 };
  const checkout = (payments: unknown[], extra: object = {}) => ({
    cashSessionId: UUID(1),
    payments,
    verifiedUnits: 2,
    ...extra,
  });

  it('acepta efectivo con recibido, tarjeta con referencia y pagos vacíos', () => {
    expect(PaymentInput.safeParse(cash).success).toBe(true);
    expect(
      PaymentInput.safeParse({ method: 'CARD', amount: 30000, reference: 'AUT-123' }).success,
    ).toBe(true);
    expect(CheckoutInput.safeParse(checkout([])).success).toBe(true);
    expect(
      CheckoutInput.safeParse(
        checkout([
          { method: 'CASH', amount: 20000 },
          { method: 'CARD', amount: 30000 },
          { method: 'TRANSFER', amount: 1000 },
        ]),
      ).success,
    ).toBe(true);
  });

  it('sin cashSessionId o sin verifiedUnits → error', () => {
    expect(pathsOf(CheckoutInput, { payments: [], verifiedUnits: 0 })).toEqual(['cashSessionId']);
    expect(pathsOf(CheckoutInput, { cashSessionId: UUID(1), payments: [] })).toEqual([
      'verifiedUnits',
    ]);
  });

  it.each([
    ['efectivo con recibido menor', { ...cash, received: 100000 }, 'received'],
    ['recibido en tarjeta', { method: 'CARD', amount: 100, received: 100 }, 'received'],
    ['referencia en efectivo', { method: 'CASH', amount: 100, reference: 'X' }, 'reference'],
    ['monto 0', { method: 'CARD', amount: 0 }, 'amount'],
    ['monto decimal', { method: 'CARD', amount: 10.5 }, 'amount'],
  ])('%s → error en %s', (_caso, payment, path) => {
    expect(pathsOf(PaymentInput, payment)).toEqual([path]);
  });

  it('dos pagos del mismo método o 4 pagos → error', () => {
    expect(
      pathsOf(
        CheckoutInput,
        checkout([
          { method: 'CARD', amount: 100 },
          { method: 'CARD', amount: 200 },
        ]),
      ),
    ).toEqual(['payments.1.method']);
    const four = ['CASH', 'CARD', 'TRANSFER', 'CASH'].map((method) => ({ method, amount: 1 }));
    expect(CheckoutInput.safeParse(checkout(four)).success).toBe(false);
  });

  it('el nombre del cliente vacío se guarda como null', () => {
    expect(CheckoutInput.parse(checkout([], { customerName: '  ' })).customerName).toBeNull();
  });

  it('computeChange', () => {
    expect(computeChange(130000, 124800)).toBe(5200);
    expect(computeChange(124800, 124800)).toBe(0);
    expect(() => computeChange(100000, 124800)).toThrow(RangeError);
    expect(() => computeChange(100.5, 100)).toThrow(RangeError);
  });
});

describe('entradas del carrito, caja y folio (T3)', () => {
  it('CartUpdateInput es estricto y exige al menos un campo', () => {
    expect(CartUpdateInput.safeParse({}).success).toBe(false);
    expect(CartUpdateInput.safeParse({ extra: 1 }).success).toBe(false);
    expect(CartUpdateInput.parse({ discount: 4800 })).toEqual({ discount: 4800 });
    expect(CartUpdateInput.parse({ label: '  ' })).toEqual({ label: null });
    expect(CartUpdateInput.parse({ customerName: ' María ' })).toEqual({ customerName: 'María' });
  });

  it('CartItemUpdateInput pide cantidad o descuento y libera al rack por defecto', () => {
    expect(CartItemUpdateInput.safeParse({ releaseTo: 'STAGING' }).success).toBe(false);
    expect(CartItemUpdateInput.parse({ quantity: 2 })).toEqual({ quantity: 2, releaseTo: 'RACK' });
    expect(CartItemUpdateInput.parse({ quantity: 1, releaseTo: 'STAGING' }).releaseTo).toBe(
      'STAGING',
    );
    expect(CartItemUpdateInput.safeParse({ quantity: 0 }).success).toBe(false);
    expect(CartItemUpdateInput.safeParse({ discount: 10, extra: true }).success).toBe(false);
  });

  it('SaleCancelInput exige un motivo de al menos 3 caracteres', () => {
    expect(pathsOf(SaleCancelInput, { reason: ' ab ' })).toEqual(['reason']);
    expect(SaleCancelInput.parse({ reason: ' Error de captura ' })).toEqual({
      reason: 'Error de captura',
    });
  });

  it('OpenSessionInput rechaza un fondo negativo', () => {
    expect(pathsOf(OpenSessionInput, { cashRegisterId: UUID(1), openingAmount: -1 })).toEqual([
      'openingAmount',
    ]);
    expect(OpenSessionInput.safeParse({ cashRegisterId: UUID(1), openingAmount: 0 }).success).toBe(
      true,
    );
  });

  it('formatFolio', () => {
    expect(formatFolio('S1', 123)).toBe('S1-000123');
    expect(formatFolio('S1', 1234567)).toBe('S1-1234567');
    expect(() => formatFolio('S1', 0)).toThrow(RangeError);
  });
});

describe('etiquetas y DTOs del POS (T4)', () => {
  const user = (n: number, fullName: string) => ({ id: UUID(n), fullName });
  const register = { code: 'C1', name: 'Caja 1' };
  const session = {
    id: UUID(10),
    cashRegisterId: UUID(11),
    openedById: UUID(1),
    openedAt: NOW,
    openingAmount: 50000,
    closedById: UUID(2),
    closedAt: NOW,
    expectedAmount: 194800,
    countedAmount: 194780,
    difference: -20,
    status: 'CLOSED',
    cashRegister: { id: UUID(11), ...register },
    openedBy: user(1, 'Luis Pérez'),
    closedBy: user(2, 'Ana López'),
    ...stamps,
  };
  const sale = {
    id: UUID(20),
    folio: 'S1-000001',
    branchId: UUID(30),
    cashRegisterId: UUID(11),
    cashSessionId: UUID(10),
    sellerId: UUID(1),
    cashierId: UUID(2),
    cartId: UUID(40),
    customerName: null,
    subtotal: 124800,
    globalDiscount: 0,
    discountTotal: 0,
    taxRateBp: 1600,
    pricesIncludeTax: true,
    taxTotal: 17214,
    total: 124800,
    status: 'COMPLETED',
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    ...stamps,
  };
  const ticket = {
    sale,
    items: [
      {
        id: UUID(21),
        saleId: UUID(20),
        variantId: UUID(50),
        sourceRackId: UUID(60),
        skuSnapshot: 'ZAP0101-25-NEG',
        nameSnapshot: 'Zapato de piel dama',
        variantLabelSnapshot: '25 · Negro',
        unitPrice: 89900,
        quantity: 1,
        discount: 0,
        lineTotal: 89900,
        createdAt: NOW,
      },
    ],
    payments: [
      {
        id: UUID(22),
        saleId: UUID(20),
        method: 'CASH',
        amount: 124800,
        received: 130000,
        change: 5200,
        reference: null,
        createdAt: NOW,
      },
    ],
    branch: {
      code: 'S1',
      name: 'Sucursal 1',
      legalName: null,
      taxId: null,
      address: null,
      phone: '5512345678',
      logoUrl: null,
      ticketHeader: null,
      ticketFooterMessage: 'Gracias por su compra',
      promoQrText: 'DESC10',
      promoQrCaption: 'Muestra este QR',
      timezone: 'America/Mexico_City',
      currency: 'MXN',
    },
    cashRegister: register,
    seller: user(1, 'Luis Pérez'),
    cashier: user(2, 'Ana López'),
    cancelledBy: null,
  };

  it('PAYMENT_METHOD_LABELS cubre los 3 métodos', () => {
    expect(Object.keys(PAYMENT_METHOD_LABELS).sort()).toEqual([...PaymentMethod.options].sort());
    expect(PAYMENT_METHOD_LABELS.CASH).toBe('Efectivo');
  });

  it('CartDetailDto', () => {
    const cart = {
      id: UUID(40),
      branchId: UUID(30),
      userId: UUID(1),
      number: 12,
      status: 'ACTIVE',
      label: 'Señora vestido rojo',
      customerName: null,
      discount: 0,
      owner: user(1, 'Luis Pérez'),
      items: [
        {
          id: UUID(41),
          cartId: UUID(40),
          variantId: UUID(50),
          sourceRackId: UUID(60),
          quantity: 1,
          unitPrice: 89900,
          discount: 0,
          sku: 'ZAP0101-25-NEG',
          barcode: null,
          productName: 'Zapato de piel dama',
          variantLabel: '25 · Negro',
          thumbUrl: null,
          locationCode: 'A-01-01',
          isStaging: false,
          lineTotal: 89900,
          ...stamps,
        },
      ],
      totals: {
        subtotal: 89900,
        lineDiscounts: 0,
        globalDiscount: 0,
        discountTotal: 0,
        taxTotal: 12400,
        total: 89900,
        taxRateBp: 1600,
        pricesIncludeTax: true,
      },
      ...stamps,
    };
    expect(CartDetailDto.parse(cart)).toEqual(cart);
  });

  it('SaleTicketDto normal y cancelada', () => {
    expect(SaleTicketDto.parse(ticket)).toEqual(ticket);
    const cancelled = {
      ...ticket,
      sale: {
        ...sale,
        status: 'CANCELLED',
        cancelledAt: NOW,
        cancelledById: UUID(3),
        cancelReason: 'Error de captura',
      },
      cancelledBy: user(3, 'Gerente'),
    };
    expect(SaleTicketDto.parse(cancelled)).toEqual(cancelled);
  });

  it('CashSessionSummaryDto con diferencia negativa', () => {
    const summary = {
      session,
      salesCount: 2,
      salesTotal: 174800,
      cancelledCount: 1,
      cancelledTotal: 34900,
      byMethod: [
        { method: 'CASH', count: 2, amount: 144800 },
        { method: 'CARD', count: 1, amount: 30000 },
        { method: 'TRANSFER', count: 0, amount: 0 },
      ],
      expectedAmount: 194800,
      countedAmount: 194780,
      difference: -20,
    };
    expect(CashSessionSummaryDto.parse(summary)).toEqual(summary);
  });

  it('PosRegisterDto con y sin sesión abierta', () => {
    const base = { id: UUID(11), branchId: UUID(30), ...register, isActive: true, ...stamps };
    const open = {
      ...base,
      openSession: { id: UUID(10), openedAt: NOW, openedBy: user(1, 'Luis Pérez') },
    };
    expect(PosRegisterDto.parse({ ...base, openSession: null })).toEqual({
      ...base,
      openSession: null,
    });
    expect(PosRegisterDto.parse(open)).toEqual(open);
  });
});
