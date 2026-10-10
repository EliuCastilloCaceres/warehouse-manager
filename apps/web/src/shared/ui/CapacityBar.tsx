import { cn } from '@/lib/utils';

export interface CapacityBarProps {
  used: number;
  capacity: number;
  /** Ubicación sin límite (staging): no hay color de estado. */
  unlimited?: boolean;
  label?: string;
}

type CapacityStatus = 'ok' | 'warning' | 'danger' | 'none';

/** Espacio de no separación: el porcentaje no se parte del signo "%". */
const NBSP = String.fromCharCode(0xa0);

const FILL: Record<CapacityStatus, string> = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-600',
  none: 'bg-muted-foreground/40',
};

/** Verde < 70 %, ámbar de 70 % a 90 % (inclusive) y rojo > 90 % (plan §4.3). */
export function capacityStatus(used: number, capacity: number): Exclude<CapacityStatus, 'none'> {
  // Se compara en enteros para no depender del redondeo de punto flotante.
  if (used * 100 < capacity * 70) return 'ok';
  if (used * 100 <= capacity * 90) return 'warning';
  return 'danger';
}

/** Barra de ocupación: "34 / 40 (85 %)". Por encima del 100 % se llena en rojo con el porcentaje real. */
export function CapacityBar({ used, capacity, unlimited, label = 'Capacidad' }: CapacityBarProps) {
  let status: CapacityStatus;
  let text: string;
  let fill: number;
  if (unlimited) {
    status = 'none';
    text = 'Sin límite';
    fill = 0;
  } else if (capacity <= 0) {
    status = 'none';
    text = 'Sin capacidad';
    fill = 0;
  } else {
    const percent = (used / capacity) * 100;
    status = capacityStatus(used, capacity);
    text = `${used} / ${capacity} (${Math.round(percent)}${NBSP}%)`;
    fill = Math.min(percent, 100);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={!unlimited && capacity > 0 ? capacity : undefined}
        aria-valuetext={text}
        data-status={status}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full', FILL[status])} style={{ width: `${fill}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
