import type { VariantDetailDto } from '@warehouse-manager/shared';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { centsToPesos, type VariantRow } from './variantRows';

export interface VariantsTableProps {
  rows: readonly VariantRow[];
  onChange: (rows: VariantRow[]) => void;
  /** Precio del producto en pesos: el placeholder del precio propio. */
  productPrice: number | null;
  /** Variantes guardadas, para el estado activo. */
  saved?: readonly VariantDetailDto[];
  onToggleActive?: (variant: VariantDetailDto, isActive: boolean) => void;
  errors: Record<string, string>;
  readOnly?: boolean;
}

type Field = 'sku' | 'size' | 'color' | 'material' | 'price' | 'barcode';
const COLUMNS: [Field, string][] = [
  ['sku', 'SKU'],
  ['size', 'Talla'],
  ['color', 'Color'],
  ['material', 'Material'],
  ['price', 'Precio'],
  ['barcode', 'Código de barras'],
];

/**
 * Variantes del producto: SKU y atributos editables; "Quitar" la saca del producto al guardar.
 * Tabla desde `md`; tarjetas con los campos apilados en el celular.
 */
export function VariantsTable({
  rows,
  onChange,
  productPrice,
  saved = [],
  onToggleActive,
  errors,
  readOnly,
}: VariantsTableProps) {
  const isDesktop = useIsDesktop();
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Aún no hay variantes.</p>;
  }

  const update = (index: number, field: Field, value: string) =>
    onChange(
      rows.map((row, i) =>
        i === index
          ? { ...row, [field]: value, ...(field === 'sku' ? { skuEdited: true } : {}) }
          : row,
      ),
    );

  const errorOf = (index: number, field: Field) =>
    errors[`variants.${index}.${field === 'price' ? 'priceOverride' : field}`] ??
    (field === 'size' ? errors[`variants.${index}`] : undefined);

  const input = (row: VariantRow, index: number, field: Field, label: string) => {
    const error = errorOf(index, field);
    return (
      <>
        <Input
          id={`variant-${row.key}-${field}`}
          aria-label={`${label} de la variante ${index + 1}`}
          value={row[field]}
          readOnly={readOnly}
          aria-invalid={!!error}
          className={field === 'sku' ? 'font-mono' : undefined}
          placeholder={
            field === 'price' && productPrice !== null ? centsToPesos(productPrice) : undefined
          }
          inputMode={field === 'price' ? 'decimal' : undefined}
          onChange={(event) => update(index, field, event.target.value)}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </>
    );
  };

  const active = (row: VariantRow) => {
    const savedVariant = saved.find((v) => v.id === row.id);
    if (!savedVariant) return <span className="text-muted-foreground">Nueva</span>;
    return (
      <Checkbox
        aria-label={`Variante ${savedVariant.sku} activa`}
        checked={savedVariant.isActive}
        disabled={readOnly || !onToggleActive}
        onCheckedChange={(checked) => onToggleActive?.(savedVariant, checked === true)}
      />
    );
  };

  const remove = (row: VariantRow, index: number) =>
    !readOnly && (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Quitar la variante ${row.sku || index + 1}`}
        onClick={() => onChange(rows.filter((_, i) => i !== index))}
      >
        <Trash2 />
      </Button>
    );

  if (!isDesktop) {
    return (
      <ul aria-label="Variantes" className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Variante {index + 1}</span>
              <div className="flex items-center gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  {active(row)}
                  {saved.some((v) => v.id === row.id) && 'Activa'}
                </label>
                {remove(row, index)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {COLUMNS.map(([field, label]) => (
                <div
                  key={field}
                  className={cn(
                    'min-w-0 space-y-1',
                    (field === 'sku' || field === 'barcode') && 'col-span-2',
                  )}
                >
                  <Label htmlFor={`variant-${row.key}-${field}`} aria-hidden>
                    {label}
                  </Label>
                  {input(row, index, field, label)}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table aria-label="Variantes" className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            {COLUMNS.map(([, label]) => (
              <th key={label} scope="col" className="px-2 py-2 font-medium">
                {label}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 font-medium">
              Activa
            </th>
            <th scope="col" className="sr-only">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-t align-top">
              {COLUMNS.map(([field, label]) => (
                <td key={field} className="px-2 py-1">
                  {input(row, index, field, label)}
                </td>
              ))}
              <td className="px-2 py-1">
                <div className="flex h-11 items-center">{active(row)}</div>
              </td>
              <td className="px-2 py-1">{remove(row, index)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
