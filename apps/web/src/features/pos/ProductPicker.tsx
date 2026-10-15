import {
  type LocateResultDto,
  type LocateVariantDto,
  variantLabel,
} from '@warehouse-manager/shared';
import { useState } from 'react';
import { ColorDot } from '@/features/warehouse/components';
import { cn } from '@/lib/utils';
import { Money } from '@/shared/format/Money';
import { Button } from '@/shared/ui/button';

const ATTRIBUTES = [
  ['size', 'Talla'],
  ['color', 'Color'],
  ['material', 'Material'],
] as const;

type Attribute = (typeof ATTRIBUTES)[number][0];
type Selection = Partial<Record<Attribute, string>>;

export const VARIANT_INACTIVE_MESSAGE = 'Este producto está desactivado y no se puede vender.';

const matches = (item: LocateVariantDto, selection: Selection, skip?: Attribute) =>
  ATTRIBUTES.every(
    ([attr]) =>
      attr === skip || selection[attr] === undefined || item.variant[attr] === selection[attr],
  );

function OtherBranches({ item, highlight }: { item: LocateVariantDto; highlight: boolean }) {
  if (!item.otherBranches || item.otherBranches.length === 0) return null;
  return (
    <section
      aria-label="En otras sucursales"
      className={cn('flex flex-col gap-1 text-sm', highlight && 'font-bold')}
    >
      {item.otherBranches.map((branch) => (
        <p key={branch.branchId}>
          {[`Hay en ${branch.name} (${branch.available})`, branch.phone]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ))}
    </section>
  );
}

/**
 * Producto buscado en Atender (spec F8 §7): tallas, colores y materiales de sus variantes (✕ =
 * sin disponibles aquí), ubicaciones de la variante elegida con [Agregar] y, con permiso, lo que
 * hay en otras sucursales (arriba y en negritas si aquí no hay).
 */
export function ProductPicker({
  result,
  canAdd,
  onAdd,
}: {
  result: LocateResultDto;
  canAdd: boolean;
  onAdd: (variantId: string, rackId: string) => void;
}) {
  const { product, variants } = result;
  const [selection, setSelection] = useState<Selection>(() =>
    variants.length === 1
      ? Object.fromEntries(
          ATTRIBUTES.flatMap(([attr]) => {
            const value = variants[0]!.variant[attr];
            return value ? [[attr, value]] : [];
          }),
        )
      : {},
  );

  const groups = ATTRIBUTES.map(([attr, label]) => ({
    attr,
    label,
    values: [...new Set(variants.map((v) => v.variant[attr]).filter((v): v is string => !!v))],
  })).filter((group) => group.values.length > 0);

  // Un atributo con un solo valor (p. ej. todo es de piel) no es una elección: queda elegido.
  const effective: Selection = {
    ...selection,
    ...Object.fromEntries(
      groups
        .filter((group) => group.values.length === 1)
        .map((group) => [group.attr, group.values[0]]),
    ),
  };
  const candidates = variants.filter((item) => matches(item, effective));
  const selected =
    variants.length === 1
      ? variants[0]!
      : groups.every((group) => effective[group.attr] !== undefined) && candidates.length === 1
        ? candidates[0]!
        : null;

  const availableFor = (attr: Attribute, value: string) =>
    variants
      .filter((item) => item.variant[attr] === value && matches(item, effective, attr))
      .reduce((sum, item) => sum + item.totals.available, 0);

  const price = selected?.variant.effectivePrice ?? product.price;
  const locations = selected?.locations.filter((location) => location.available > 0) ?? [];
  const noneHere = !!selected && selected.totals.available === 0;
  const inactive = !!selected && !selected.variant.isEffectivelyActive;

  return (
    <article aria-label={product.name} className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex gap-3">
        {(selected?.variant.thumbUrl ?? product.thumbUrl) && (
          <img
            src={selected?.variant.thumbUrl ?? product.thumbUrl!}
            alt=""
            className="size-16 rounded object-cover"
          />
        )}
        <div className="flex flex-col">
          <p className="font-medium">{product.name}</p>
          <Money cents={price} className="text-lg" />
        </div>
      </div>

      {groups.map(({ attr, label, values }) => (
        <div
          key={attr}
          role="group"
          aria-label={label}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="w-16 text-sm text-muted-foreground">{label}:</span>
          {values.map((value) => {
            const none = availableFor(attr, value) === 0;
            const pressed = effective[attr] === value;
            return (
              <Button
                key={value}
                size="sm"
                variant={pressed ? 'default' : 'outline'}
                aria-pressed={pressed}
                aria-label={none ? `${value} (sin disponibles aquí)` : value}
                className={cn(none && 'text-muted-foreground line-through')}
                onClick={() =>
                  values.length > 1 &&
                  setSelection((current) => ({ ...current, [attr]: pressed ? undefined : value }))
                }
              >
                {value}
                {none && ' ✕'}
              </Button>
            );
          })}
        </div>
      ))}

      {!selected && (
        <p className="text-sm text-muted-foreground">Elige la variante para ver sus ubicaciones.</p>
      )}

      {selected && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {[variantLabel(selected.variant), `${selected.totals.available} disponibles`]
              .filter(Boolean)
              .join(' · ')}{' '}
            <span className="font-mono text-muted-foreground">{selected.variant.sku}</span>
          </p>
          {inactive && (
            <p role="alert" className="text-sm text-destructive">
              {VARIANT_INACTIVE_MESSAGE}
            </p>
          )}
          {noneHere && <OtherBranches item={selected} highlight />}
          {locations.length > 0 && (
            <ul aria-label="Ubicaciones" className="flex flex-col divide-y rounded-md border">
              {locations.map((location) => (
                <li key={location.rackId} className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <ColorDot hex={location.colorHex} />
                  <span className="font-mono font-medium">{location.locationCode}</span>
                  <span className="flex-1 text-sm">{location.available}</span>
                  <Button
                    className="h-11"
                    aria-label={`Agregar desde ${location.locationCode}`}
                    disabled={!canAdd || inactive}
                    onClick={() => onAdd(selected.variant.id, location.rackId)}
                  >
                    Agregar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {noneHere && (
            <p className="text-sm text-muted-foreground">Sin disponibles en esta sucursal.</p>
          )}
          {!noneHere && <OtherBranches item={selected} highlight={false} />}
        </div>
      )}
    </article>
  );
}
