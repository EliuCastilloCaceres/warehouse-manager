import { render, screen } from '@testing-library/react';
import { CapacityBar } from './CapacityBar';

describe('CapacityBar (T22)', () => {
  it.each([
    [0, 40, 'ok', '0 / 40 (0 %)'],
    [27, 40, 'ok', '27 / 40 (68 %)'],
    [28, 40, 'warning', '28 / 40 (70 %)'],
    [34, 40, 'warning', '34 / 40 (85 %)'],
    [36, 40, 'warning', '36 / 40 (90 %)'],
    [37, 40, 'danger', '37 / 40 (93 %)'],
    [45, 40, 'danger', '45 / 40 (113 %)'],
  ])('%i/%i → %s, "%s"', (used, capacity, status, text) => {
    render(<CapacityBar used={used} capacity={capacity} />);

    const meter = screen.getByRole('meter', { name: 'Capacidad' });
    expect(meter).toHaveAttribute('data-status', status);
    expect(meter).toHaveAttribute('aria-valuenow', String(used));
    expect(meter).toHaveAttribute('aria-valuemax', String(capacity));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('por encima del 100 % la barra se llena completa', () => {
    render(<CapacityBar used={45} capacity={40} />);
    expect(screen.getByRole('meter').firstElementChild).toHaveStyle({ width: '100%' });
  });

  it('unlimited → "Sin límite", sin color de estado', () => {
    render(<CapacityBar used={120} capacity={0} unlimited />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('data-status', 'none');
    expect(meter).toHaveAttribute('aria-valuenow', '120');
    expect(screen.getByText('Sin límite')).toBeInTheDocument();
  });

  it('capacidad 0 → "Sin capacidad"', () => {
    render(<CapacityBar used={0} capacity={0} />);

    expect(screen.getByRole('meter')).toHaveAttribute('data-status', 'none');
    expect(screen.getByText('Sin capacidad')).toBeInTheDocument();
  });
});
