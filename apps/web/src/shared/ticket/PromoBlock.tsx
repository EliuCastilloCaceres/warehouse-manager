import { promoBlock } from '@warehouse-manager/shared';
import { QrCode } from '@/shared/print/QrCode';
import type { TicketBranch, TicketWidth } from './TicketHeader';

/**
 * QR de promoción (spec F5 §8.1): el QR lleva el `payload` (`PROMO:<texto>` o el enlace tal
 * cual); debajo, el texto sin prefijo y la descripción. Solo descripción → mensaje; nada → nada.
 */
export function PromoBlock({
  branch,
  width,
}: {
  branch: Pick<TicketBranch, 'promoQrText' | 'promoQrCaption'>;
  width: TicketWidth;
}) {
  const block = promoBlock(branch);
  if (!block) return null;
  if (block.kind === 'message') {
    return <p className="whitespace-pre-line text-center">{block.caption}</p>;
  }
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <QrCode value={block.payload} className={width === 80 ? 'w-[30mm]' : 'w-[24mm]'} />
      <p className="break-all">{block.text}</p>
      {block.caption && <p className="whitespace-pre-line">{block.caption}</p>}
    </div>
  );
}
