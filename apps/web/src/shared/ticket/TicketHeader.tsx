import type { BranchDto } from '@warehouse-manager/shared';

/**
 * Campos de la sucursal que imprime el ticket. Es un subconjunto de `BranchDto` (y de
 * `TicketBranchDto` de F8), así que sirven el DTO, los valores del formulario o el ticket real.
 */
export type TicketBranch = Pick<
  BranchDto,
  | 'name'
  | 'legalName'
  | 'taxId'
  | 'address'
  | 'phone'
  | 'logoUrl'
  | 'ticketHeader'
  | 'ticketFooterMessage'
  | 'promoQrText'
  | 'promoQrCaption'
>;

/** Ancho del papel de la térmica, en mm. */
export type TicketWidth = 80 | 58;

/** Ancho imprimible: 72 mm en papel de 80 y 48 mm en papel de 58 (plan §7.2). */
export const TICKET_CONTENT_WIDTH: Record<TicketWidth, string> = { 80: '72mm', 58: '48mm' };

/** Logo, nombre, razón social, RFC, dirección, teléfono y encabezado libre. */
export function TicketHeader({
  branch,
  width,
}: {
  branch: Pick<
    TicketBranch,
    'name' | 'legalName' | 'taxId' | 'address' | 'phone' | 'logoUrl' | 'ticketHeader'
  >;
  width: TicketWidth;
}) {
  return (
    <header className="flex flex-col items-center gap-0.5 text-center">
      {branch.logoUrl && (
        <img
          src={branch.logoUrl}
          alt={`Logo de ${branch.name}`}
          className={
            width === 80 ? 'mb-1 max-h-[20mm] max-w-[50mm]' : 'mb-1 max-h-[16mm] max-w-[36mm]'
          }
        />
      )}
      <p className="font-bold">{branch.name}</p>
      {branch.legalName && <p>{branch.legalName}</p>}
      {branch.taxId && <p>RFC: {branch.taxId}</p>}
      {branch.address && <p>{branch.address}</p>}
      {branch.phone && <p>Tel. {branch.phone}</p>}
      {branch.ticketHeader && <p className="mt-1 whitespace-pre-line">{branch.ticketHeader}</p>}
    </header>
  );
}
