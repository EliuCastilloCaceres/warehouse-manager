import type { ReleaseTo } from '@warehouse-manager/shared';
import { ArrowLeft } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';

export const CASH_SESSION_CLOSED_MESSAGE = 'La caja se cerró';
export const NO_OPEN_REGISTERS_MESSAGE = 'No hay cajas abiertas';
export const MAX_SUSPENDED_MESSAGE = 'Ya tienes 5 carritos suspendidos';

/** "Ana López" → "Ana". */
export const firstName = (fullName: string) => fullName.split(' ')[0] ?? fullName;

/** "1 pza" / "3 pzas". */
export const pieces = (n: number) => `${n} ${n === 1 ? 'pza' : 'pzas'}`;

/** Regreso al inicio del POS. */
export function PosBackLink() {
  return (
    <Link
      to="/pos"
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      POS
    </Link>
  );
}

/** Campo de dinero en pesos (texto con teclado numérico); el padre convierte con `parseMoney`. */
export function MoneyInput({
  label,
  value,
  onChange,
  autoFocus,
  invalid,
  placeholder = '$0.00',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className="h-12 text-lg tabular-nums"
        value={value}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Liberar todas las piezas de uno o varios carritos: a su ubicación o a staging. */
export function ReleaseAllButtons({
  onChoose,
  disabled,
}: {
  onChoose: (releaseTo: ReleaseTo) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button className="h-12" disabled={disabled} onClick={() => onChoose('RACK')}>
        Regresar todo a su ubicación
      </Button>
      <Button
        className="h-12"
        variant="outline"
        disabled={disabled}
        onClick={() => onChoose('STAGING')}
      >
        Enviar todo a staging
      </Button>
    </div>
  );
}

export interface ReleaseTarget {
  locationCode: string;
  isStaging: boolean;
}

/**
 * Hoja "¿Qué hacemos con el producto?" al quitar o bajar piezas: a su ubicación o a staging.
 * Una pieza tomada de staging solo puede regresar ahí (decisión 2026-10-15).
 */
export function ReleaseSheet({
  target,
  onOpenChange,
  onChoose,
}: {
  target: ReleaseTarget | null;
  onOpenChange: (open: boolean) => void;
  onChoose: (releaseTo: ReleaseTo) => void;
}) {
  const choose = (releaseTo: ReleaseTo) => {
    onOpenChange(false);
    onChoose(releaseTo);
  };
  return (
    <ResponsiveDialog
      open={!!target}
      onOpenChange={onOpenChange}
      title="¿Qué hacemos con el producto?"
    >
      {target && (
        <div className="flex flex-col gap-2 pb-4">
          <Button className="h-14" onClick={() => choose('RACK')}>
            {target.isStaging
              ? `Regresar a staging (${target.locationCode})`
              : `Regresar a su ubicación (${target.locationCode})`}
          </Button>
          {!target.isStaging && (
            <Button className="h-14" variant="outline" onClick={() => choose('STAGING')}>
              Enviar a staging
            </Button>
          )}
        </div>
      )}
    </ResponsiveDialog>
  );
}
