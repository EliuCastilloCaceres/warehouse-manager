import { render, screen } from '@testing-library/react';
import { PromoBlock } from './PromoBlock';
import { TicketFooter } from './TicketFooter';

describe('PromoBlock (T21)', () => {
  it.each([
    ['un código', 'DESC10', 'PROMO:DESC10'],
    ['un enlace', 'https://ejemplo.com', 'https://ejemplo.com'],
  ])('QR + descripción: con %s el QR recibe el payload', (_caso, text, payload) => {
    render(
      <PromoBlock
        branch={{ promoQrText: text, promoQrCaption: 'Muestra este QR en caja' }}
        width={80}
      />,
    );
    expect(screen.getByRole('img', { name: payload })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('Muestra este QR en caja')).toBeInTheDocument();
  });

  it('solo QR: sin descripción', () => {
    const { container } = render(
      <PromoBlock branch={{ promoQrText: 'DESC10', promoQrCaption: null }} width={58} />,
    );
    expect(screen.getByRole('img', { name: 'PROMO:DESC10' })).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('solo mensaje: la descripción sin QR', () => {
    render(
      <PromoBlock branch={{ promoQrText: '  ', promoQrCaption: 'Síguenos en redes' }} width={80} />,
    );
    expect(screen.getByText('Síguenos en redes')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('nada: no imprime nada', () => {
    const { container } = render(
      <PromoBlock branch={{ promoQrText: null, promoQrCaption: null }} width={80} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('TicketFooter muestra el mensaje final y el bloque de promoción', () => {
    render(
      <TicketFooter
        branch={{
          ticketFooterMessage: 'Gracias por su compra',
          promoQrText: 'DESC10',
          promoQrCaption: null,
        }}
        width={80}
      />,
    );
    expect(screen.getByText('Gracias por su compra')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'PROMO:DESC10' })).toBeInTheDocument();
  });
});
