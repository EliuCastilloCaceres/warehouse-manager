import { PAYMENT_METHOD_LABELS, type SaleListItemDto } from '@warehouse-manager/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Can } from '@/features/auth/guards';
import { errorMessage } from '@/shared/api/errors';
import { DEFAULT_TIME_ZONE, formatTime } from '@/shared/format/date';
import { Money } from '@/shared/format/Money';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states';
import { posApi, useDeviceSession, usePosBranch } from './api';
import { CancelSaleDialog } from './CancelSaleDialog';
import { PosBackLink } from './components';
import { readTicketSettings } from './device';
import { SaleTicket } from './ticket/SaleTicket';
import { useTicketPrint } from './ticket/useTicketPrint';

export const NO_DEVICE_REGISTER_MESSAGE = 'Este dispositivo no tiene una caja para cobrar.';

/**
 * `/pos/sales` (Mi caja · Historial): ventas cobradas en la caja del dispositivo, con
 * [Reimprimir] y, con `pos.sale.cancel` y la caja abierta, [Cancelar venta].
 */
export function SessionSalesPage() {
  const device = useDeviceSession();
  const branch = usePosBranch();
  const sessionId = device.stored?.sessionId;
  const sales = useQuery({
    queryKey: ['pos-sales', sessionId],
    queryFn: () => posApi.sessionSales(sessionId!),
    enabled: !!sessionId,
  });
  const { printTicket, printElement } = useTicketPrint();
  const [cancelling, setCancelling] = useState<SaleListItemDto | null>(null);
  const timeZone = branch.data?.timezone ?? DEFAULT_TIME_ZONE;

  const reprint = useMutation({
    mutationFn: (saleId: string) => posApi.ticket(saleId),
    onSuccess: (ticket) => {
      const { width } = readTicketSettings();
      printTicket(<SaleTicket ticket={ticket} width={width} />, width);
    },
    onError: (error) => notify.error(error),
  });

  return (
    <section className="flex flex-col gap-4">
      <PosBackLink />
      <h1 className="text-xl font-semibold">
        Mi caja · Historial
        {device.session && ` · ${device.session.cashRegister.name}`}
      </h1>
      {!device.stored && (
        <EmptyState message={NO_DEVICE_REGISTER_MESSAGE}>
          <Button asChild variant="outline">
            <Link to="/pos/register?next=%2Fpos%2Fsales">Elegir caja</Link>
          </Button>
        </EmptyState>
      )}
      {sessionId && sales.isPending && <LoadingState />}
      {sales.error && (
        <ErrorState message={errorMessage(sales.error)} onRetry={() => void sales.refetch()} />
      )}
      {sales.data && sales.data.items.length === 0 && (
        <EmptyState message="Todavía no hay ventas en esta caja." />
      )}
      {sales.data && sales.data.items.length > 0 && (
        <ul aria-label="Ventas" className="flex flex-col divide-y rounded-md border">
          {sales.data.items.map((sale) => (
            <li
              key={sale.id}
              aria-label={`Venta ${sale.folio}`}
              className="flex flex-col gap-2 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono font-medium">{sale.folio}</span>
                <span className="text-sm text-muted-foreground">
                  {formatTime(sale.createdAt, timeZone)}
                </span>
                <Money cents={sale.total} className="font-medium" />
              </div>
              <p className="text-sm text-muted-foreground">
                {[
                  `Vendió ${sale.seller.fullName}`,
                  sale.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    sale.status === 'CANCELLED' ? 'font-medium text-destructive' : 'text-sm'
                  }
                >
                  {sale.status === 'CANCELLED' ? 'Cancelada' : 'Cobrada'}
                </span>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reprint.isPending}
                  onClick={() => reprint.mutate(sale.id)}
                >
                  Reimprimir
                </Button>
                {sale.status === 'COMPLETED' && device.isOpen && (
                  <Can perm="pos.sale.cancel">
                    <Button size="sm" variant="destructive" onClick={() => setCancelling(sale)}>
                      Cancelar venta
                    </Button>
                  </Can>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CancelSaleDialog sale={cancelling} onClose={() => setCancelling(null)} />
      {printElement}
    </section>
  );
}
