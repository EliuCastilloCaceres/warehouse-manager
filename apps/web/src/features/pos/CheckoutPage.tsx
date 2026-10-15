import {
  type CartDetailDto,
  type CheckoutInput,
  formatMoney,
  parseMoney,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type SaleTicketDto,
} from '@warehouse-manager/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { Money } from '@/shared/format/Money';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ConfirmDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { posApi, useCart, useDeviceSession } from './api';
import { CheckoutVerification, type Verified, verifiedUnits } from './CheckoutVerification';
import { CASH_SESSION_CLOSED_MESSAGE, MoneyInput, PosBackLink } from './components';
import { readTicketSettings } from './device';
import { SaleTicket } from './ticket/SaleTicket';
import { useTicketPrint } from './ticket/useTicketPrint';

export const CART_CLOSED_MESSAGE = 'El carrito ya se cobró o se descartó.';

type NonCash = Exclude<PaymentMethod, 'CASH'>;
const METHODS: readonly PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER'];

/** Montos redondos para el efectivo: al siguiente múltiplo de $50, $100 y $500. */
export function cashShortcuts(total: number): number[] {
  if (total <= 0) return [];
  return [...new Set([5000, 10000, 50000].map((step) => Math.ceil(total / step) * step))];
}

const toText = (cents: number) => (cents / 100).toFixed(2);

interface PaymentState {
  methods: PaymentMethod[];
  cash: string;
  amounts: Record<NonCash, string>;
  references: Record<NonCash, string>;
}

/**
 * Lo pagado y si cuadra con el total: el efectivo es lo recibido (cubre lo que falte después de
 * tarjeta y transferencia y da cambio); tarjeta y transferencia suman su monto exacto.
 */
export function paymentSummary(total: number, state: PaymentState) {
  const nonCash = state.methods.filter((m): m is NonCash => m !== 'CASH');
  const amounts = nonCash.map((m) => parseMoney(state.amounts[m]));
  const nonCashTotal = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const withCash = state.methods.includes('CASH');
  const received = withCash ? parseMoney(state.cash) : null;
  const cashAmount = withCash ? total - nonCashTotal : 0;
  const paid = nonCashTotal + (received ?? 0);
  const valid =
    total === 0 ||
    (amounts.every((a) => a !== null && a > 0) &&
      (withCash
        ? cashAmount > 0 && received !== null && received >= cashAmount
        : nonCashTotal === total));
  const payments: CheckoutInput['payments'] =
    total === 0
      ? []
      : [
          ...(withCash
            ? [{ method: 'CASH' as const, amount: cashAmount, received: received! }]
            : []),
          ...nonCash.map((method, i) => {
            const reference = state.references[method].trim();
            return { method, amount: amounts[i]!, ...(reference ? { reference } : {}) };
          }),
        ];
  return {
    paid,
    /** Lo que falta cubrir en efectivo después de tarjeta y transferencia. */
    cashDue: Math.max(cashAmount, 0),
    change: withCash && received !== null ? Math.max(received - cashAmount, 0) : 0,
    valid,
    payments,
  };
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function CheckoutForm({
  cart,
  cashSessionId,
  registerLabel,
  registerUrl,
  onSold,
  onSessionClosed,
}: {
  cart: CartDetailDto;
  cashSessionId: string;
  registerLabel: string;
  registerUrl: string;
  onSold: (ticket: SaleTicketDto) => void;
  onSessionClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const total = cart.totals.total;
  const units = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const [verified, setVerified] = useState<Verified>({});
  const [state, setState] = useState<PaymentState>({
    methods: [],
    cash: '',
    amounts: { CARD: '', TRANSFER: '' },
    references: { CARD: '', TRANSFER: '' },
  });
  const [customerName, setCustomerName] = useState(cart.customerName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const summary = paymentSummary(total, state);
  const verifiedCount = verifiedUnits(cart.items, verified);
  const missing = units - verifiedCount;

  const toggle = (method: PaymentMethod) =>
    setState((current) => {
      if (current.methods.includes(method)) {
        return { ...current, methods: current.methods.filter((m) => m !== method) };
      }
      const methods = METHODS.filter((m) => m === method || current.methods.includes(m));
      // Un solo método sin efectivo: se propone el total.
      const amounts =
        method !== 'CASH' && current.methods.length === 0
          ? { ...current.amounts, [method]: toText(total) }
          : current.amounts;
      return { ...current, methods, amounts };
    });

  const checkout = useMutation({
    mutationFn: () =>
      posApi.checkout(cart.id, {
        cashSessionId,
        payments: summary.payments,
        customerName,
        verifiedUnits: verifiedCount,
      }),
    onSuccess: (ticket) => {
      for (const key of ['cart', 'pos-carts', 'pos-sales', 'pos-lookup']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onSold(ticket);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CASH_SESSION_CLOSED') {
        notify.error(CASH_SESSION_CLOSED_MESSAGE);
        onSessionClosed();
      } else if (err instanceof ApiError && err.code === 'PAYMENT_TOTAL_MISMATCH') {
        setError(err.message);
      } else {
        notify.error(err);
        void queryClient.invalidateQueries({ queryKey: ['cart', cart.id] });
      }
    },
  });

  const confirm = () => {
    setError(null);
    if (missing > 0) setConfirming(true);
    else checkout.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Cobrando en {registerLabel} · Carrito #{cart.number} de {cart.owner.fullName}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={registerUrl}>Cambiar caja</Link>
        </Button>
      </div>

      <CheckoutVerification items={cart.items} verified={verified} onChange={setVerified} />

      <p className="flex items-baseline justify-between text-lg">
        Total a cobrar <Money cents={total} className="text-3xl font-bold" />
      </p>

      {total > 0 && (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Formas de pago" className="flex flex-wrap gap-2">
            {METHODS.map((method) => (
              <Button
                key={method}
                className="h-12"
                variant={state.methods.includes(method) ? 'default' : 'outline'}
                aria-pressed={state.methods.includes(method)}
                onClick={() => toggle(method)}
              >
                {PAYMENT_METHOD_LABELS[method]}
              </Button>
            ))}
          </div>
          {state.methods.includes('CASH') && (
            <div className="flex flex-col gap-2">
              <MoneyInput
                label="Efectivo recibido"
                value={state.cash}
                onChange={(cash) => setState((s) => ({ ...s, cash }))}
              />
              <div className="flex flex-wrap gap-2">
                {cashShortcuts(summary.cashDue).map((amount) => (
                  <Button
                    key={amount}
                    size="sm"
                    variant="outline"
                    onClick={() => setState((s) => ({ ...s, cash: toText(amount) }))}
                  >
                    {formatMoney(amount)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {state.methods
            .filter((m): m is NonCash => m !== 'CASH')
            .map((method) => (
              <div key={method} className="grid grid-cols-2 gap-2">
                <MoneyInput
                  label={PAYMENT_METHOD_LABELS[method]}
                  value={state.amounts[method]}
                  onChange={(value) =>
                    setState((s) => ({ ...s, amounts: { ...s.amounts, [method]: value } }))
                  }
                />
                <Field
                  label={`Referencia (${PAYMENT_METHOD_LABELS[method]})`}
                  value={state.references[method]}
                  onChange={(value) =>
                    setState((s) => ({ ...s, references: { ...s.references, [method]: value } }))
                  }
                />
              </div>
            ))}
          <p className="text-sm">
            Pagado {formatMoney(summary.paid)} · Cambio{' '}
            <span className="font-medium">{formatMoney(summary.change)}</span>
          </p>
        </div>
      )}

      <Field label="Cliente (opcional)" value={customerName} onChange={setCustomerName} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        className="h-14 text-lg"
        disabled={!summary.valid || checkout.isPending}
        onClick={confirm}
      >
        Confirmar cobro
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Faltan ${missing} piezas por verificar. ¿Cobrar de todos modos?`}
        confirmLabel="Cobrar"
        onConfirm={() => checkout.mutate()}
      />
    </div>
  );
}

/** Ticket recién cobrado: vista previa con [Imprimir] y [Listo]. */
function SoldTicket({
  ticket,
  onPrint,
  onDone,
}: {
  ticket: SaleTicketDto;
  onPrint: () => void;
  onDone: () => void;
}) {
  const { width } = readTicketSettings();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-medium">Venta {ticket.sale.folio} cobrada</p>
      <div
        data-testid="ticket-preview"
        className="flex justify-center overflow-x-auto rounded-md border bg-white p-3"
      >
        <SaleTicket ticket={ticket} width={width} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-12 flex-1" onClick={onPrint}>
          Imprimir
        </Button>
        <Button className="h-12 flex-1" onClick={onDone}>
          Listo
        </Button>
      </div>
    </div>
  );
}

/**
 * `/pos/checkout/:cartId` (spec F8 §7): cobra en la caja del dispositivo. Sin caja guardada o con
 * su sesión cerrada lleva a elegir caja y vuelve aquí; el carrito no se pierde.
 */
export function CheckoutPage() {
  const { cartId } = useParams();
  const navigate = useNavigate();
  const device = useDeviceSession();
  const cart = useCart(cartId);
  const [ticket, setTicket] = useState<SaleTicketDto | null>(null);
  const { printTicket, printElement } = useTicketPrint();
  const registerUrl = `/pos/register?next=${encodeURIComponent(`/pos/checkout/${cartId}`)}`;

  const print = (sold: SaleTicketDto) => {
    const { width } = readTicketSettings();
    printTicket(<SaleTicket ticket={sold} width={width} />, width);
  };

  if (!ticket) {
    if (!device.stored) return <Navigate to={registerUrl} replace />;
    if (device.isPending) return <LoadingState />;
    if (!device.isOpen) return <Navigate to={registerUrl} replace />;
  }

  return (
    <section className="flex flex-col gap-4">
      <PosBackLink />
      <h1 className="text-xl font-semibold">Cobro</h1>
      {ticket ? (
        <SoldTicket ticket={ticket} onPrint={() => print(ticket)} onDone={() => navigate('/pos')} />
      ) : (
        <>
          {cart.isPending && <LoadingState />}
          {cart.error && (
            <ErrorState message={errorMessage(cart.error)} onRetry={() => void cart.refetch()} />
          )}
          {cart.data && !['ACTIVE', 'SUSPENDED'].includes(cart.data.status) && (
            <p role="alert" className="text-destructive">
              {CART_CLOSED_MESSAGE}
            </p>
          )}
          {cart.data && ['ACTIVE', 'SUSPENDED'].includes(cart.data.status) && device.session && (
            <CheckoutForm
              cart={cart.data}
              cashSessionId={device.session.id}
              registerLabel={device.session.cashRegister.name}
              registerUrl={registerUrl}
              onSold={(sold) => {
                setTicket(sold);
                if (readTicketSettings().autoPrint) print(sold);
              }}
              onSessionClosed={() => {
                device.forget();
                navigate(registerUrl);
              }}
            />
          )}
        </>
      )}
      {printElement}
    </section>
  );
}
