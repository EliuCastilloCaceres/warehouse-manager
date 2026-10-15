import { applyBasisPoints, formatMoney, parseMoney } from '@warehouse-manager/shared';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { MoneyInput } from './components';

type Mode = 'amount' | 'percent';

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "10" → 1000 bp, "12.5" → 1250 bp; `null` si no es un porcentaje de 0 a 100. */
export function parsePercentBp(text: string): number | null {
  const match = PERCENT.exec(text.trim().replace(/%$/, '').trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

export interface DiscountTarget {
  title: string;
  /** Importe sobre el que se aplica el porcentaje y tope del descuento, en centavos. */
  base: number;
  current: number;
  /** Total del carrito con ese descuento (para la vista previa). */
  totalWith: (discount: number) => number;
}

/**
 * Descuento en monto o en porcentaje (spec F8 §7): el porcentaje se convierte a centavos con
 * `applyBasisPoints` sobre el importe. Se envía siempre en centavos.
 */
export function DiscountDialog({
  target,
  onClose,
  onApply,
}: {
  target: DiscountTarget | null;
  onClose: () => void;
  onApply: (discount: number) => void;
}) {
  const [mode, setMode] = useState<Mode>('amount');
  const [value, setValue] = useState('');

  const close = () => {
    setValue('');
    setMode('amount');
    onClose();
  };
  const apply = (discount: number) => {
    onApply(discount);
    close();
  };

  let discount: number | null = null;
  let error: string | null = null;
  if (target && value.trim() !== '') {
    if (mode === 'amount') {
      discount = parseMoney(value);
      if (discount === null) error = 'Escribe un monto válido';
    } else {
      const bp = parsePercentBp(value);
      if (bp === null) error = 'Escribe un porcentaje de 0 a 100';
      else discount = applyBasisPoints(target.base, bp);
    }
    if (discount !== null && discount > target.base) {
      error = `El descuento no puede superar ${formatMoney(target.base)}`;
      discount = null;
    }
  }

  return (
    <ResponsiveDialog
      open={!!target}
      onOpenChange={(open) => !open && close()}
      title={target?.title ?? ''}
      footer={
        <>
          {target && target.current > 0 && (
            <Button variant="outline" onClick={() => apply(0)}>
              Quitar descuento
            </Button>
          )}
          <Button disabled={discount === null} onClick={() => apply(discount!)}>
            Aplicar
          </Button>
        </>
      }
    >
      {target && (
        <div className="flex flex-col gap-3 pb-2">
          <div role="group" aria-label="Tipo de descuento" className="flex gap-1">
            {(
              [
                ['amount', 'Monto'],
                ['percent', '%'],
              ] as const
            ).map(([option, label]) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={mode === option ? 'default' : 'outline'}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {label}
              </Button>
            ))}
          </div>
          <MoneyInput
            label={mode === 'amount' ? 'Descuento ($)' : 'Descuento (%)'}
            placeholder={mode === 'amount' ? '$0.00' : '0 %'}
            value={value}
            onChange={setValue}
            invalid={!!error}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {discount !== null && (
            <p className="text-sm">
              Descuento {formatMoney(discount)} · Total nuevo{' '}
              <span className="font-medium">{formatMoney(target.totalWith(discount))}</span>
            </p>
          )}
        </div>
      )}
    </ResponsiveDialog>
  );
}
