import { render, screen } from '@testing-library/react';
import { TicketHeader } from './TicketHeader';

const branch = {
  name: 'Sucursal Centro',
  legalName: null,
  taxId: 'CEJ010101AB1',
  address: null,
  phone: '55 1234 5678',
  logoUrl: '/uploads/branch/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.webp',
  ticketHeader: null,
};

describe('TicketHeader', () => {
  it.each([
    [80, 'max-w-[50mm]'],
    [58, 'max-w-[36mm]'],
  ] as const)('en %i mm ajusta el logo y omite los campos vacíos', (width, logoClass) => {
    const { container } = render(<TicketHeader branch={branch} width={width} />);
    expect(screen.getByRole('img', { name: 'Logo de Sucursal Centro' })).toHaveClass(logoClass);
    expect(screen.getByText('RFC: CEJ010101AB1')).toBeInTheDocument();
    expect(screen.getByText('Tel. 55 1234 5678')).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(3);
  });
});
