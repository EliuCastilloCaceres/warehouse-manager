import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { Can } from '@/features/auth/guards';
import { NOT_A_PRODUCT_MESSAGE } from '@/features/warehouse/components';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import {
  posApi,
  useCart,
  useCartChanged,
  useCarts,
  useDeviceSession,
  usePosBranch,
  usePosRegisters,
} from './api';
import { CartBar, suspendedCount } from './CartBar';
import { CartPanel, cartTotalWith, linesNet } from './CartPanel';
import { firstName, NO_OPEN_REGISTERS_MESSAGE } from './components';
import { DiscountDialog } from './DiscountDialog';
import { ProductPicker } from './ProductPicker';
import { TicketSettingsDialog } from './ticket/TicketSettingsDialog';

export const PRODUCT_NOT_FOUND = 'No se encontró el producto';

/** Aviso de un QR de promoción escaneado (decisión de F5: el descuento se captura a mano). */
function PromoDialog({
  text,
  onClose,
  onApplyDiscount,
}: {
  text: string | null;
  onClose: () => void;
  onApplyDiscount: (() => void) | null;
}) {
  const branch = usePosBranch();
  const matches = !!text && text === branch.data?.promoQrText?.trim();
  return (
    <ResponsiveDialog
      open={text !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Promoción"
      footer={
        <>
          {onApplyDiscount && (
            <Can perm="pos.discount">
              <Button
                onClick={() => {
                  onClose();
                  onApplyDiscount();
                }}
              >
                Aplicar descuento
              </Button>
            </Can>
          )}
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1 pb-2">
        <p>Código de promoción: {text}</p>
        {matches && branch.data?.promoQrCaption && (
          <p className="text-sm text-muted-foreground">{branch.data.promoQrCaption}</p>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function PosMenu({ hasRegister }: { hasRegister: boolean }) {
  const [open, setOpen] = useState(false);
  const [ticketSettings, setTicketSettings] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Menu aria-hidden />
        Menú
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Menú">
        <nav aria-label="Menú del POS" className="flex flex-col gap-2 pb-4">
          <Button asChild variant="outline" className="h-12">
            <Link to="/pos/carts">Carritos de la sucursal</Link>
          </Button>
          {hasRegister && (
            <Button asChild variant="outline" className="h-12">
              <Link to="/pos/sales">Mi caja</Link>
            </Button>
          )}
          <Button
            variant="outline"
            className="h-12"
            onClick={() => {
              setOpen(false);
              setTicketSettings(true);
            }}
          >
            Ajustes del ticket
          </Button>
        </nav>
      </ResponsiveDialog>
      <TicketSettingsDialog open={ticketSettings} onOpenChange={setTicketSettings} />
    </>
  );
}

/**
 * `/pos/sell` (Atender, spec F8 §7): sin elegir caja. El vendedor busca un producto, elige talla
 * y color y lo agrega desde un rack (reserva la unidad). El primer "Agregar" crea el carrito.
 */
export function PosSalePage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const changed = useCartChanged();
  const device = useDeviceSession();
  const registers = usePosRegisters();
  const myCarts = useCarts('mine');
  const carts = myCarts.data ?? [];
  const active = carts.find((cart) => cart.status === 'ACTIVE') ?? null;
  const cart = useCart(active?.id);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [promo, setPromo] = useState<string | null>(null);
  const [globalDiscount, setGlobalDiscount] = useState(false);

  const lookup = useQuery({
    queryKey: ['pos-lookup', code],
    queryFn: () => posApi.lookup(code!),
    enabled: !!code,
  });
  const noOpenRegisters = !!registers.data && !registers.data.some((r) => r.openSession);

  const add = useMutation({
    mutationFn: async ({ variantId, rackId }: { variantId: string; rackId: string }) => {
      const cartId = active?.id ?? (await posApi.createCart()).id;
      return posApi.addItem(cartId, { variantId, sourceRackId: rackId, quantity: 1 });
    },
    onSuccess: (result) => changed(result),
    onError: (error) => {
      notify.error(error);
      if (error instanceof ApiError && error.code === 'NO_OPEN_CASH_SESSION') {
        void queryClient.invalidateQueries({ queryKey: ['pos-registers'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['pos-lookup'] });
    },
  });
  const setDiscount = useMutation({
    mutationFn: (discount: number) => posApi.updateCart(cart.data!.id, { discount }),
    onSuccess: (result) => changed(result),
    onError: (error) => notify.error(error),
  });

  const onScan = (scan: ValidScan) => {
    setMessage(null);
    if (scan.kind === 'promo') setPromo(scan.text);
    else if (scan.kind === 'location') setMessage(NOT_A_PRODUCT_MESSAGE);
    else setCode(scan.code);
  };

  const notFound = lookup.error instanceof ApiError && lookup.error.code === 'NOT_FOUND';
  const current = cart.data && cart.data.id === active?.id ? cart.data : null;
  const canDiscountCart = !!current && current.items.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Atender · {me ? firstName(me.user.fullName) : ''}</h1>
        <PosMenu hasRegister={!!device.stored} />
      </div>

      {noOpenRegisters && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive p-3"
        >
          <span className="font-medium text-destructive">{NO_OPEN_REGISTERS_MESSAGE}</span>
          <Can perm="pos.session.open">
            <Button asChild variant="outline">
              <Link to="/pos/register?next=%2Fpos%2Fsell">Abrir caja</Link>
            </Button>
          </Can>
        </div>
      )}

      <CartBar carts={carts} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <ScanInput
            label="Buscar producto"
            placeholder="Escanea o escribe un SKU"
            captureHid
            onScan={onScan}
          />
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          {code && lookup.isPending && <LoadingState />}
          {notFound && (
            <p role="alert" className="text-sm text-destructive">
              {PRODUCT_NOT_FOUND}
            </p>
          )}
          {lookup.error && !notFound && (
            <ErrorState
              message={errorMessage(lookup.error)}
              onRetry={() => void lookup.refetch()}
            />
          )}
          {lookup.data && (
            <ProductPicker
              key={code}
              result={lookup.data}
              canAdd={!!registers.data && !noOpenRegisters && !add.isPending}
              onAdd={(variantId, rackId) => add.mutate({ variantId, rackId })}
            />
          )}
        </div>

        {current && (
          <CartPanel
            cart={current}
            suspended={suspendedCount(carts)}
            onGlobalDiscount={() => setGlobalDiscount(true)}
          />
        )}
      </div>

      <PromoDialog
        text={promo}
        onClose={() => setPromo(null)}
        onApplyDiscount={canDiscountCart ? () => setGlobalDiscount(true) : null}
      />
      <DiscountDialog
        target={
          globalDiscount && current
            ? {
                title: `Descuento al carrito #${current.number}`,
                base: linesNet(current),
                current: current.discount,
                totalWith: (value) => cartTotalWith(current, { global: value }),
              }
            : null
        }
        onClose={() => setGlobalDiscount(false)}
        onApply={(value) => setDiscount.mutate(value)}
      />
    </section>
  );
}
