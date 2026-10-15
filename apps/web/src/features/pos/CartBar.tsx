import {
  type CartDetailDto,
  type CartSummaryDto,
  MAX_SUSPENDED_CARTS_PER_USER,
} from '@warehouse-manager/shared';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { posApi, useCartChanged } from './api';
import { MAX_SUSPENDED_MESSAGE } from './components';

/** "#12 Señora rojo": número y, si tiene, etiqueta o cliente. */
export const cartChipLabel = (cart: Pick<CartSummaryDto, 'number' | 'label' | 'customerName'>) =>
  [`#${cart.number}`, cart.label ?? cart.customerName].filter(Boolean).join(' ');

export const suspendedCount = (carts: readonly CartSummaryDto[]) =>
  carts.filter((cart) => cart.status === 'SUSPENDED').length;

/**
 * Barra de carritos del vendedor (spec F8 §7): el activo y los suspendidos con su número;
 * tocar uno suspendido lo retoma; [+] crea otro (el activo con partidas pasa a suspendido).
 */
export function CartBar({ carts }: { carts: readonly CartSummaryDto[] }) {
  const changed = useCartChanged();
  const active = carts.find((cart) => cart.status === 'ACTIVE');
  const atLimit =
    suspendedCount(carts) >= MAX_SUSPENDED_CARTS_PER_USER && (active?.itemCount ?? 0) > 0;

  const resume = useMutation({
    mutationFn: (id: string) => posApi.resume(id),
    onSuccess: (cart) => changed(cart),
    onError: (error) => notify.error(error),
  });
  const create = useMutation({
    mutationFn: () => posApi.createCart(),
    onSuccess: (cart) => changed(cart),
    onError: (error) => notify.error(error),
  });

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Mis carritos" className="flex flex-wrap items-center gap-2">
        {carts.map((cart) => {
          const isActive = cart.status === 'ACTIVE';
          return (
            <Button
              key={cart.id}
              size="sm"
              variant={isActive ? 'default' : 'outline'}
              aria-pressed={isActive}
              disabled={resume.isPending}
              onClick={() => !isActive && resume.mutate(cart.id)}
            >
              {cartChipLabel(cart)}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant="outline"
          aria-label="Nuevo carrito"
          title={atLimit ? MAX_SUSPENDED_MESSAGE : undefined}
          disabled={atLimit || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus />
        </Button>
      </div>
      {active && (
        <p className="text-sm text-muted-foreground">
          <span className="text-2xl font-bold text-foreground">Carrito #{active.number}</span>{' '}
          (díselo al cliente para pagar)
        </p>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** [Suspender]: pide etiqueta y cliente (opcionales); con 5 suspendidos se deshabilita. */
export function SuspendCartButton({ cart, suspended }: { cart: CartDetailDto; suspended: number }) {
  const changed = useCartChanged();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const atLimit = suspended >= MAX_SUSPENDED_CARTS_PER_USER;

  const suspend = useMutation({
    mutationFn: () => posApi.suspend(cart.id, { label, customerName }),
    onSuccess: async (result) => {
      setOpen(false);
      notify.success(`Carrito #${result.number} suspendido`);
      await changed(result);
    },
    onError: (error) => notify.error(error),
  });

  const start = () => {
    setLabel(cart.label ?? '');
    setCustomerName(cart.customerName ?? '');
    setOpen(true);
  };

  return (
    <>
      <div className="flex flex-col items-end">
        <Button
          variant="outline"
          className="h-12"
          disabled={atLimit || cart.items.length === 0}
          onClick={start}
        >
          Suspender
        </Button>
        {atLimit && <span className="text-xs text-muted-foreground">{MAX_SUSPENDED_MESSAGE}</span>}
      </div>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={`Suspender carrito #${cart.number}`}
        description="Para encontrarlo después (opcional)."
        footer={
          <Button disabled={suspend.isPending} onClick={() => suspend.mutate()}>
            Suspender
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <TextField label="Etiqueta" value={label} onChange={setLabel} />
          <TextField label="Cliente" value={customerName} onChange={setCustomerName} />
        </div>
      </ResponsiveDialog>
    </>
  );
}
