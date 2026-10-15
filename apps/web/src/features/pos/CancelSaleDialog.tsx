import { SaleCancelInput, type SaleListItemDto } from '@warehouse-manager/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { posApi } from './api';

/**
 * Cancelar una venta completa (con `pos.sale.cancel`): el motivo es obligatorio; el stock va a
 * staging y su dinero deja de contar en el corte.
 */
export function CancelSaleDialog({
  sale,
  onClose,
}: {
  sale: SaleListItemDto | null;
  onClose: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const parsed = SaleCancelInput.safeParse({ reason });
  const close = () => {
    setReason('');
    onClose();
  };
  const cancel = useMutation({
    mutationFn: () => posApi.cancelSale(sale!.id, parsed.data!),
    onSuccess: (ticket) => {
      notify.success(`Venta ${ticket.sale.folio} cancelada`);
      void queryClient.invalidateQueries({ queryKey: ['pos-sales'] });
      close();
    },
    onError: (error) => notify.error(error),
  });
  return (
    <ResponsiveDialog
      open={!!sale}
      onOpenChange={(open) => !open && close()}
      title={sale ? `Cancelar venta ${sale.folio}` : ''}
      description="Se cancela completa: las piezas regresan al staging."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={!parsed.success || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancelar venta
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1 pb-2">
        <Label htmlFor={id}>Motivo</Label>
        <Input
          id={id}
          value={reason}
          maxLength={300}
          aria-invalid={reason !== '' && !parsed.success ? true : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {reason !== '' && !parsed.success && (
          <p className="text-sm text-destructive">{parsed.error.issues[0]?.message}</p>
        )}
      </div>
    </ResponsiveDialog>
  );
}
