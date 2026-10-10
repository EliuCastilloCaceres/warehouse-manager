import { render, screen } from '@testing-library/react';
import { Barcode, isValidCode128 } from './Barcode';

// JsBarcode mide el texto con un canvas, que jsdom no implementa.
beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        measureText: (text: string) => ({ width: text.length * 8 }),
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Barcode (T29)', () => {
  it('ZAP0101-25-NEG renderiza un <svg> con barras y el texto visible', () => {
    render(<Barcode value="ZAP0101-25-NEG" />);

    const svg = screen.getByRole('img', { name: 'ZAP0101-25-NEG' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(10);
    expect(svg.querySelector('text')).toHaveTextContent('ZAP0101-25-NEG');
    expect(svg).toHaveAttribute('viewBox');
  });

  it('al cambiar el valor se vuelve a dibujar', () => {
    const { rerender } = render(<Barcode value="ZAP0101-25-NEG" />);
    rerender(<Barcode value="BOL0201-UN-CAF" />);
    expect(screen.getByRole('img').querySelector('text')).toHaveTextContent('BOL0201-UN-CAF');
  });

  it.each([[''], ['ZAPATO-ÑU'], ['ZAP\n01']])('"%s" → "Código inválido"', (value) => {
    render(<Barcode value={value} />);
    expect(screen.getByText('Código inválido')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('isValidCode128 acepta ASCII imprimible', () => {
    expect(isValidCode128('LOC:A-01-03')).toBe(true);
    expect(isValidCode128(' ')).toBe(true);
    expect(isValidCode128('')).toBe(false);
  });
});
