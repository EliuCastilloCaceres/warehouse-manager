import {
  type CashSessionSummaryDto,
  formatMoney,
  parseMoney,
  PAYMENT_METHOD_LABELS,
  type ReleaseTo,
} from '@warehouse-manager/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { ApiError } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { EmptyState, LoadingState } from '@/shared/ui/states';
import { posApi, useDeviceSession, usePosBranch } from './api';
import {
  CASH_SESSION_CLOSED_MESSAGE,
  firstName,
  MoneyInput,
  PosBackLink,
  pieces,
  ReleaseAllButtons,
} from './components';
import { CashCloseTicket } from './ticket/CashCloseTicket';
import { useTicketPrint } from './ticket/useTicketPrint';

export const NO_OPEN_DEVICE_REGISTER = 'Este dispositivo no tiene una caja abierta.';

interface PendingCart {
  id: string;
  number: number;
  owner: { fullName: string };
  unitCount: number;
}

/** `details.carts` de un `CASH_SESSION_HAS_OPEN_CARTS`. */
function pendingCartsOf(error: unknown): PendingCart[] | null {
  if (!(error instanceof ApiError) || error.code !== 'CASH_SESSION_HAS_OPEN_CARTS') return null;
  const carts = (error.details as { carts?: PendingCart[] } | undefined)?.carts;
  return Array.isArray(carts) ? carts : [];
}

/** Paso 2: esperado, contado, diferencia (negativa en rojo) y desglose. */
function CloseSummary({
  summary,
  onPrint,
}: {
  summary: CashSessionSummaryDto;
  onPrint: () => void;
}) {
  const negative = summary.difference < 0;
  return (
    <section aria-label="Resultado del corte" className="flex flex-col gap-2">
      <h2 className="font-medium">Paso 2 · Resultado</h2>
      <p>
        Fondo {formatMoney(summary.session.openingAmount)} · Ventas {summary.salesCount} (
        {formatMoney(summary.salesTotal)}) · Canceladas {summary.cancelledCount} (
        {formatMoney(summary.cancelledTotal)})
      </p>
      <p>
        {summary.byMethod
          .map((row) => `${PAYMENT_METHOD_LABELS[row.method]} ${formatMoney(row.amount)}`)
          .join(' · ')}
      </p>
      <p className="text-lg">
        Esperado {formatMoney(summary.expectedAmount)} · Contado{' '}
        {formatMoney(summary.countedAmount)} ·{' '}
        <span data-testid="difference" className={cn('font-bold', negative && 'text-destructive')}>
          Diferencia {negative ? '−' : ''}
          {formatMoney(Math.abs(summary.difference))}
        </span>
      </p>
      <Button variant="outline" className="h-12 self-start" onClick={onPrint}>
        Imprimir corte
      </Button>
    </section>
  );
}

/**
 * `/pos/close` (Mi caja · Corte ciego, spec F8 §3): primero se captura el efectivo contado y
 * después se ve el esperado y la diferencia. Si es la última caja abierta y hay carritos
 * pendientes, se liberan todos (a su ubicación o a staging) y se cierra. Al terminar, el
 * dispositivo olvida su caja.
 */
export function CloseSessionPage() {
  const queryClient = useQueryClient();
  const device = useDeviceSession();
  const branch = usePosBranch();
  const [counted, setCounted] = useState('');
  const [pending, setPending] = useState<PendingCart[] | null>(null);
  const [summary, setSummary] = useState<CashSessionSummaryDto | null>(null);
  const { printTicket, printElement } = useTicketPrint();
  const countedAmount = counted.trim() === '' ? null : parseMoney(counted);

  const close = useMutation({
    mutationFn: () =>
      posApi.closeSession(device.stored!.sessionId, { countedAmount: countedAmount! }),
    onSuccess: (result) => {
      setSummary(result);
      setPending(null);
      device.forget();
      for (const key of ['pos-registers', 'pos-session', 'pos-carts']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => {
      const carts = pendingCartsOf(error);
      if (carts) {
        setPending(carts);
      } else if (error instanceof ApiError && error.code === 'CASH_SESSION_CLOSED') {
        notify.error(CASH_SESSION_CLOSED_MESSAGE);
        device.forget();
      } else {
        notify.error(error);
      }
    },
  });
  const releaseAll = useMutation({
    mutationFn: (releaseTo: ReleaseTo) => posApi.releaseAll(releaseTo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos-carts'] });
      close.mutate();
    },
    onError: (error) => notify.error(error),
  });

  const print = () =>
    printTicket(<CashCloseTicket summary={summary!} branch={branch.data ?? null} />, 80);

  return (
    <section className="flex flex-col gap-4">
      <PosBackLink />
      <h1 className="text-xl font-semibold">Mi caja · Corte</h1>
      {summary ? (
        <CloseSummary summary={summary} onPrint={print} />
      ) : device.isPending ? (
        <LoadingState />
      ) : !device.isOpen ? (
        <EmptyState message={NO_OPEN_DEVICE_REGISTER}>
          <Button asChild variant="outline">
            <Link to="/pos/register?next=%2Fpos%2Fclose">Elegir caja</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="font-medium">
            Paso 1 · Cuenta el efectivo de la caja {device.session?.cashRegister.name}
          </h2>
          <MoneyInput
            label="Efectivo contado"
            value={counted}
            onChange={setCounted}
            invalid={counted.trim() !== '' && countedAmount === null}
            autoFocus
          />
          <Button
            className="h-12 self-start"
            disabled={countedAmount === null || close.isPending || releaseAll.isPending}
            onClick={() => close.mutate()}
          >
            Cerrar caja
          </Button>
          {pending && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-amber-500 p-3"
            >
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert aria-hidden className="size-5 text-amber-600" />
                {pending.length} {pending.length === 1 ? 'carrito' : 'carritos'} con productos
                reservados:{' '}
                {pending
                  .map((cart) => `${firstName(cart.owner.fullName)} (${pieces(cart.unitCount)})`)
                  .join(', ')}
              </p>
              <ReleaseAllButtons
                disabled={releaseAll.isPending || close.isPending}
                onChoose={(releaseTo) => releaseAll.mutate(releaseTo)}
              />
            </div>
          )}
        </div>
      )}
      {printElement}
    </section>
  );
}
