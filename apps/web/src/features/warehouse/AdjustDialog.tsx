import {
  ADJUSTMENT_REASON_LABELS,
  type AdjustDirection,
  AdjustInput,
  AdjustmentReason,
} from '@warehouse-manager/shared';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { inventoryApi, useInvalidateStock } from './api';
import { QuantityStepper, useCapacityGuard } from './components';

export interface AdjustTarget {
  variant: { id: string; sku: string; label: string | null };
  rack: { id: string; locationCode: string };
}

interface Errors {
  reason?: string;
  note?: string;
}

/** Ajuste de inventario: entrada o salida, cantidad, motivo de la lista y nota obligatoria. */
export function AdjustDialog({
  target,
  onClose,
}: {
  target: AdjustTarget | null;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title="Ajustar inventario"
      description={
        target
          ? `${target.variant.sku}${target.variant.label ? ` · ${target.variant.label}` : ''} en ${target.rack.locationCode}`
          : undefined
      }
    >
      {target && (
        <AdjustForm
          key={`${target.variant.id}-${target.rack.id}`}
          target={target}
          onDone={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function AdjustForm({ target, onDone }: { target: AdjustTarget; onDone: () => void }) {
  const ids = { reason: useId(), note: useId() };
  const invalidate = useInvalidateStock();
  const [direction, setDirection] = useState<AdjustDirection>('IN');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const guard = useCapacityGuard(async (overrideCapacity) => {
    const parsed = AdjustInput.safeParse({
      variantId: target.variant.id,
      rackId: target.rack.id,
      direction,
      quantity,
      reason: reason || undefined,
      note,
      overrideCapacity,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'reason') next.reason = 'El motivo es obligatorio';
        if (field === 'note') next.note = 'La nota es obligatoria';
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await inventoryApi.adjust(parsed.data);
    await invalidate();
    notify.success('Ajuste guardado');
    onDone();
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        void guard.submit();
      }}
    >
      <div role="group" aria-label="Tipo de ajuste" className="grid grid-cols-2 gap-2">
        {(
          [
            ['IN', 'Entrada'],
            ['OUT', 'Salida'],
          ] as const
        ).map(([value, text]) => (
          <Button
            key={value}
            type="button"
            variant={direction === value ? 'default' : 'outline'}
            aria-pressed={direction === value}
            className="h-14"
            onClick={() => setDirection(value)}
          >
            {text}
          </Button>
        ))}
      </div>

      <QuantityStepper value={quantity} onChange={setQuantity} />

      <div className="space-y-1">
        <Label htmlFor={ids.reason}>Motivo</Label>
        <Select value={reason} onValueChange={(value) => setReason(value as AdjustmentReason)}>
          <SelectTrigger
            id={ids.reason}
            className="w-full"
            aria-invalid={!!errors.reason}
            aria-describedby={errors.reason ? `${ids.reason}-error` : undefined}
          >
            <SelectValue placeholder="Elige un motivo" />
          </SelectTrigger>
          <SelectContent>
            {AdjustmentReason.options.map((option) => (
              <SelectItem key={option} value={option}>
                {ADJUSTMENT_REASON_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.reason && (
          <p id={`${ids.reason}-error`} className="text-sm text-destructive">
            {errors.reason}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={ids.note}>Nota</Label>
        <textarea
          id={ids.note}
          rows={3}
          maxLength={300}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={!!errors.note}
          aria-describedby={errors.note ? `${ids.note}-error` : undefined}
          className={cn(
            'w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-invalid:border-destructive',
          )}
        />
        {errors.note && (
          <p id={`${ids.note}-error`} className="text-sm text-destructive">
            {errors.note}
          </p>
        )}
      </div>

      <Button type="submit" className="h-14" disabled={guard.busy}>
        Guardar
      </Button>
      {guard.dialog}
    </form>
  );
}
