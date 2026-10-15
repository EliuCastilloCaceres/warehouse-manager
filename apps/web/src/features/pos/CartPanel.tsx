import {
  type CartDetailDto,
  type CartItemRowDto,
  computeSaleTotals,
  formatMoney,
  type ReleaseTo,
} from '@warehouse-manager/shared';
import { useMutation } from '@tanstack/react-query';
import { Ellipsis, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Can } from '@/features/auth/guards';
import { Money } from '@/shared/format/Money';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { posApi, useCartChanged } from './api';
import { SuspendCartButton } from './CartBar';
import { pieces, ReleaseSheet } from './components';
import { DiscountDialog, type DiscountTarget } from './DiscountDialog';

/** Total del carrito con otro descuento en una partida o en el global (vista previa). */
export function cartTotalWith(
  cart: CartDetailDto,
  change: { itemId: string; discount: number } | { global: number },
): number {
  const lines = cart.items.map((item) => ({
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    discount: 'itemId' in change && change.itemId === item.id ? change.discount : item.discount,
  }));
  const net = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity - l.discount, 0);
  // Si el global ya no cabe con el nuevo descuento de partida, la API lo recorta igual.
  const globalDiscount = Math.min('global' in change ? change.global : cart.discount, net);
  return computeSaleTotals({
    lines,
    globalDiscount,
    taxRateBp: cart.totals.taxRateBp,
    pricesIncludeTax: cart.totals.pricesIncludeTax,
  }).total;
}

/** Importe de las partidas ya descontadas: el tope del descuento global. */
export const linesNet = (cart: CartDetailDto) =>
  cart.items.reduce((sum, item) => sum + item.lineTotal, 0);

const itemName = (item: CartItemRowDto) =>
  item.variantLabel ? `${item.productName} ${item.variantLabel}` : item.productName;

type Release = { item: CartItemRowDto; mode: 'decrease' | 'remove' };

/**
 * Carrito activo (spec F8 §7): partidas con su ubicación, [−] [+], opciones (quitar y, con
 * `pos.discount`, descuento) y la barra fija con el total, [Suspender] y [Cobrar].
 */
export function CartPanel({
  cart,
  suspended,
  onGlobalDiscount,
}: {
  cart: CartDetailDto;
  suspended: number;
  onGlobalDiscount: () => void;
}) {
  const changed = useCartChanged();
  const [options, setOptions] = useState<CartItemRowDto | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [discount, setDiscount] = useState<(DiscountTarget & { itemId: string }) | null>(null);

  const run = useMutation({
    mutationFn: (action: () => Promise<CartDetailDto>) => action(),
    onSuccess: (result) => changed(result),
    onError: (error) => notify.error(error),
  });

  const onRelease = (releaseTo: ReleaseTo) => {
    const { item, mode } = release!;
    run.mutate(() =>
      mode === 'remove'
        ? posApi.removeItem(cart.id, item.id, releaseTo)
        : posApi.updateItem(cart.id, item.id, { quantity: item.quantity - 1, releaseTo }),
    );
  };

  const units = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const { totals } = cart;

  return (
    <section aria-label="Carrito" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Carrito ({pieces(units)})</h2>
        <Can perm="pos.discount">
          <Button size="sm" variant="outline" disabled={units === 0} onClick={onGlobalDiscount}>
            Descuento al total
          </Button>
        </Can>
      </div>

      {cart.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Escanea un producto para agregarlo.</p>
      ) : (
        <ul aria-label="Partidas" className="flex flex-col divide-y rounded-md border">
          {cart.items.map((item) => {
            const name = itemName(item);
            return (
              <li key={item.id} className="flex flex-col gap-2 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{name}</span>
                    <span className="text-sm text-muted-foreground">
                      <span className="font-mono">{item.locationCode}</span> · {item.sku}
                    </span>
                    {item.discount > 0 && (
                      <span className="text-sm">Descuento −{formatMoney(item.discount)}</span>
                    )}
                  </div>
                  <Money cents={item.lineTotal} className="font-medium" />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="size-11"
                    aria-label={`Menos (${name})`}
                    disabled={run.isPending}
                    onClick={() =>
                      setRelease({ item, mode: item.quantity > 1 ? 'decrease' : 'remove' })
                    }
                  >
                    <Minus />
                  </Button>
                  <span aria-label={`Cantidad de ${name}`} className="w-8 text-center text-lg">
                    {item.quantity}
                  </span>
                  <Button
                    variant="outline"
                    className="size-11"
                    aria-label={`Más (${name})`}
                    disabled={run.isPending}
                    onClick={() =>
                      run.mutate(() =>
                        posApi.updateItem(cart.id, item.id, { quantity: item.quantity + 1 }),
                      )
                    }
                  >
                    <Plus />
                  </Button>
                  <span className="flex-1 text-right text-sm text-muted-foreground">
                    {formatMoney(item.unitPrice)} c/u
                  </span>
                  <Button
                    variant="ghost"
                    className="size-11"
                    aria-label={`Opciones de ${name}`}
                    onClick={() => setOptions(item)}
                  >
                    <Ellipsis />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-3">
        {totals.discountTotal > 0 && (
          <p className="flex justify-between text-sm">
            <span>Descuentos</span>
            <span className="tabular-nums">−{formatMoney(totals.discountTotal)}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg">
            Total <Money cents={totals.total} className="text-2xl font-bold" />
          </p>
          <div className="flex gap-2">
            <SuspendCartButton cart={cart} suspended={suspended} />
            {cart.items.length > 0 ? (
              <Button asChild className="h-12">
                <Link to={`/pos/checkout/${cart.id}`}>Cobrar</Link>
              </Button>
            ) : (
              <Button className="h-12" disabled>
                Cobrar
              </Button>
            )}
          </div>
        </div>
      </div>

      <ResponsiveDialog
        open={!!options}
        onOpenChange={(open) => !open && setOptions(null)}
        title={options ? itemName(options) : ''}
      >
        {options && (
          <div className="flex flex-col gap-2 pb-4">
            <Button
              variant="outline"
              className="h-12"
              onClick={() => {
                setOptions(null);
                setRelease({ item: options, mode: 'remove' });
              }}
            >
              Quitar
            </Button>
            <Can perm="pos.discount">
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  setOptions(null);
                  setDiscount({
                    itemId: options.id,
                    title: `Descuento · ${itemName(options)}`,
                    base: options.unitPrice * options.quantity,
                    current: options.discount,
                    totalWith: (value) =>
                      cartTotalWith(cart, { itemId: options.id, discount: value }),
                  });
                }}
              >
                Descuento
              </Button>
            </Can>
          </div>
        )}
      </ResponsiveDialog>

      <ReleaseSheet
        target={release ? release.item : null}
        onOpenChange={(open) => !open && setRelease(null)}
        onChoose={onRelease}
      />
      <DiscountDialog
        target={discount}
        onClose={() => setDiscount(null)}
        onApply={(value) =>
          run.mutate(() => posApi.updateItem(cart.id, discount!.itemId, { discount: value }))
        }
      />
    </section>
  );
}
