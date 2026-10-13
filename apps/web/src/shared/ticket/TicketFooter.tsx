import { PromoBlock } from './PromoBlock';
import type { TicketBranch, TicketWidth } from './TicketHeader';

/** Mensaje final de la sucursal y el QR de promoción. */
export function TicketFooter({
  branch,
  width,
}: {
  branch: Pick<TicketBranch, 'ticketFooterMessage' | 'promoQrText' | 'promoQrCaption'>;
  width: TicketWidth;
}) {
  return (
    <footer className="flex flex-col items-center gap-2 text-center">
      {branch.ticketFooterMessage && (
        <p className="whitespace-pre-line">{branch.ticketFooterMessage}</p>
      )}
      <PromoBlock branch={branch} width={width} />
    </footer>
  );
}
