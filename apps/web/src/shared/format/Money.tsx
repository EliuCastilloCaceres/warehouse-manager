import { formatMoney } from '@warehouse-manager/shared';
import { cn } from '@/lib/utils';

/** Importe en centavos con el formato de `shared` ("$1,234.50"), en cifras tabulares. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatMoney(cents)}</span>;
}
