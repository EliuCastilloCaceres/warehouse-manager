import { formatMoney } from '@warehouse-manager/shared';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime, formatTime } from './date';
import { Money } from './Money';

// Algunas versiones de ICU separan con espacios especiales (U+202F, U+00A0); `\s` los incluye.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formato de fechas y dinero (T23)', () => {
  it('formatDateTime respeta la zona en el borde de día', () => {
    expect(DEFAULT_TIME_ZONE).toBe('America/Mexico_City');
    expect(plain(formatDateTime('2026-10-02T05:30:00Z', 'America/Mexico_City'))).toBe(
      '1 oct 2026, 23:30',
    );
    expect(plain(formatDateTime('2026-10-02T05:30:00Z', 'UTC'))).toBe('2 oct 2026, 05:30');
  });

  it.each([
    ['America/Mexico_City', '1 oct 2026'],
    ['America/Tijuana', '1 oct 2026'],
    ['UTC', '2 oct 2026'],
  ])('formatDate en %s → %s', (timeZone, expected) => {
    expect(plain(formatDate('2026-10-02T05:30:00Z', timeZone))).toBe(expected);
  });

  it('formatTime usa 24 horas', () => {
    expect(formatTime('2026-10-02T05:30:00Z', 'America/Mexico_City')).toBe('23:30');
  });

  it('Money muestra formatMoney(123450)', () => {
    render(createElement(Money, { cents: 123450 }));
    expect(screen.getByText(formatMoney(123450))).toBeInTheDocument();
    expect(formatMoney(123450)).toBe('$1,234.50');
  });
});
