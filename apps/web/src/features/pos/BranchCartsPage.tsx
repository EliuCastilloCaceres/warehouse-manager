import { type CartSummaryDto, formatMoney, type ReleaseTo } from '@warehouse-manager/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '@/shared/api/errors';
import { Money } from '@/shared/format/Money';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states';
import { posApi, useCart, useCartChanged, useCarts } from './api';
import { PosBackLink, pieces, ReleaseAllButtons } from './components';

export const CART_NUMBER_NOT_FOUND = 'No hay un carrito abierto con ese número';

function CartDetailDialog({ cartId, onClose }: { cartId: string | null; onClose: () => void }) {
  const cart = useCart(cartId);
  const changed = useCartChanged();
  const [discarding, setDiscarding] = useState(false);
  const discard = useMutation({
    mutationFn: (releaseTo: ReleaseTo) => posApi.discard(cartId!, releaseTo),
    onSuccess: async (result) => {
      notify.success(`Carrito #${result.number} descartado`);
      onClose();
      await changed(result);
    },
    onError: (error) => notify.error(error),
  });
  const data = cart.data;
  return (
    <>
      <ResponsiveDialog
        open={!!cartId}
        onOpenChange={(open) => !open && onClose()}
        title={data ? `Carrito #${data.number} · ${data.owner.fullName}` : 'Carrito'}
        description={data?.label ?? data?.customerName ?? undefined}
        footer={
          data && (
            <>
              <Button variant="outline" onClick={() => setDiscarding(true)}>
                Descartar
              </Button>
              <Button asChild>
                <Link to={`/pos/checkout/${data.id}`}>Cobrar</Link>
              </Button>
            </>
          )
        }
      >
        {cart.isPending && <LoadingState />}
        {cart.error && <ErrorState message={errorMessage(cart.error)} />}
        {data && (
          <div className="flex flex-col gap-2 pb-2">
            <ul aria-label="Partidas" className="flex flex-col divide-y rounded-md border">
              {data.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {item.quantity} × {item.productName}
                    {item.variantLabel && ` ${item.variantLabel}`}{' '}
                    <span className="font-mono text-muted-foreground">{item.locationCode}</span>
                  </span>
                  <Money cents={item.lineTotal} />
                </li>
              ))}
            </ul>
            <p className="text-right font-medium">Total {formatMoney(data.totals.total)}</p>
          </div>
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={discarding && !!data}
        onOpenChange={setDiscarding}
        title={data ? `Descartar carrito #${data.number}` : ''}
        description="¿Qué hacemos con los productos?"
      >
        <div className="pb-4">
          <ReleaseAllButtons
            disabled={discard.isPending}
            onChoose={(releaseTo) => {
              setDiscarding(false);
              discard.mutate(releaseTo);
            }}
          />
        </div>
      </ResponsiveDialog>
    </>
  );
}

function CartCard({ cart, onOpen }: { cart: CartSummaryDto; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Carrito #${cart.number}`}
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50"
    >
      <span className="text-3xl font-bold">#{cart.number}</span>
      <span className="flex flex-1 flex-col">
        <span className="font-medium">{cart.owner.fullName}</span>
        {(cart.label ?? cart.customerName) && (
          <span className="text-sm text-muted-foreground">{cart.label ?? cart.customerName}</span>
        )}
        <span className="text-sm text-muted-foreground">
          {pieces(cart.unitCount)}
          {cart.status === 'SUSPENDED' && ' · suspendido'}
        </span>
      </span>
      <Money cents={cart.total} className="text-lg font-medium" />
    </button>
  );
}

/**
 * `/pos/carts` (spec F8 §7): carritos abiertos de todos los vendedores, refrescados cada 15 s;
 * "Buscar #" abre el carrito con ese número.
 */
export function BranchCartsPage() {
  const carts = useCarts('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const find = useMutation({
    mutationFn: (number: number) => posApi.carts('all', number),
    onSuccess: (found) => {
      if (found[0]) {
        setOpenId(found[0].id);
        setSearch('');
      } else {
        setMessage(CART_NUMBER_NOT_FOUND);
      }
    },
    onError: (error) => notify.error(error),
  });

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const number = Number.parseInt(search.trim().replace(/^#/, ''), 10);
    if (Number.isInteger(number) && number >= 1 && number <= 999) find.mutate(number);
    else setMessage(CART_NUMBER_NOT_FOUND);
  };

  return (
    <section className="flex flex-col gap-4">
      <PosBackLink />
      <h1 className="text-xl font-semibold">Carritos de la sucursal</h1>
      <form onSubmit={onSearch} className="flex gap-2" role="search">
        <Input
          aria-label="Buscar #"
          inputMode="numeric"
          placeholder="Buscar # (número del carrito)"
          className="h-12 text-lg"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" className="h-12">
          Buscar
        </Button>
      </form>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {carts.isPending && <LoadingState />}
      {carts.error && (
        <ErrorState message={errorMessage(carts.error)} onRetry={() => void carts.refetch()} />
      )}
      {carts.data && carts.data.length === 0 && (
        <EmptyState message="No hay carritos abiertos en la sucursal." />
      )}
      {carts.data && carts.data.length > 0 && (
        <ul aria-label="Carritos" className="grid gap-2 sm:grid-cols-2">
          {carts.data.map((cart) => (
            <li key={cart.id}>
              <CartCard cart={cart} onOpen={() => setOpenId(cart.id)} />
            </li>
          ))}
        </ul>
      )}
      <CartDetailDialog cartId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
