import { render, screen } from '@testing-library/react';
import { create } from 'qrcode';
import { QrCode } from './QrCode';

describe('QrCode (T29)', () => {
  it('LOC:A-01-03 renderiza un <svg> con <rect> y sin innerHTML', () => {
    render(<QrCode value="LOC:A-01-03" />);

    const svg = screen.getByRole('img', { name: 'LOC:A-01-03' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(20);
    expect(svg.querySelectorAll(':not(rect)')).toHaveLength(0);
  });

  it('cada módulo oscuro de la matriz queda cubierto por un <rect>', () => {
    render(<QrCode value="LOC:A-01-03" />);

    const { modules } = create('LOC:A-01-03', { errorCorrectionLevel: 'M' });
    const covered = new Set<string>();
    const [, ...runs] = Array.from(screen.getByRole('img').querySelectorAll('rect'));
    for (const rect of runs) {
      const x = Number(rect.getAttribute('x')) - 2;
      const y = Number(rect.getAttribute('y')) - 2;
      for (let i = 0; i < Number(rect.getAttribute('width')); i++) covered.add(`${y},${x + i}`);
    }
    let dark = 0;
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.get(y, x)) {
          dark++;
          expect(covered.has(`${y},${x}`)).toBe(true);
        }
      }
    }
    expect(covered.size).toBe(dark);
    expect(screen.getByRole('img')).toHaveAttribute(
      'viewBox',
      `0 0 ${modules.size + 4} ${modules.size + 4}`,
    );
  });

  it('el mismo valor produce el mismo SVG', () => {
    const first = render(<QrCode value="LOC:A-01-03" />).container.innerHTML;
    const second = render(<QrCode value="LOC:A-01-03" />).container.innerHTML;
    const other = render(<QrCode value="LOC:A-01-04" />).container.innerHTML;
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it('valor vacío → "Código inválido"', () => {
    render(<QrCode value="" />);
    expect(screen.getByText('Código inválido')).toBeInTheDocument();
  });

  it('un valor que no cabe en un QR → "Código inválido"', () => {
    render(<QrCode value={'x'.repeat(5000)} />);
    expect(screen.getByText('Código inválido')).toBeInTheDocument();
  });
});
