import {
  parseMoney,
  suggestVariantSku,
  type VariantDetailDto,
  variantKey,
} from '@warehouse-manager/shared';

/** Fila editable de la tabla de variantes. Los precios van en pesos, como se escriben. */
export interface VariantRow {
  /** Identificador local (estable aunque cambie el SKU). */
  key: string;
  /** Variante guardada (al editar). */
  id?: string;
  sku: string;
  /** El usuario escribió el SKU: ya no se sugiere. */
  skuEdited: boolean;
  size: string;
  color: string;
  material: string;
  /** Precio propio en pesos; vacío = el del producto. */
  price: string;
  barcode: string;
}

let nextKey = 0;
export const newRowKey = () => `row-${++nextKey}`;

/** Centavos → texto en pesos para un campo (`89900` → `"899.00"`). */
export const centsToPesos = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2);

/** Texto en pesos → centavos; vacío → `null`; inválido → `undefined`. */
export function pesosToCents(text: string): number | null | undefined {
  if (!text.trim()) return null;
  return parseMoney(text) ?? undefined;
}

export function rowFromVariant(variant: VariantDetailDto): VariantRow {
  return {
    key: newRowKey(),
    id: variant.id,
    sku: variant.sku,
    skuEdited: true,
    size: variant.size ?? '',
    color: variant.color ?? '',
    material: variant.material ?? '',
    price: centsToPesos(variant.priceOverride),
    barcode: variant.barcode ?? '',
  };
}

const attrsOf = (row: Pick<VariantRow, 'size' | 'color' | 'material'>) => ({
  size: row.size.trim() || null,
  color: row.color.trim() || null,
  material: row.material.trim() || null,
});

export const rowKey = (row: Pick<VariantRow, 'size' | 'color' | 'material'>) =>
  variantKey(attrsOf(row));

/** SKU sugerido de una fila (o `""` si no hay sugerencia). */
export const suggestedSku = (
  parentSku: string,
  row: Pick<VariantRow, 'size' | 'color' | 'material'>,
) => (parentSku.trim() && suggestVariantSku(parentSku, attrsOf(row))) || '';

/** Al cambiar el SKU padre, las filas con SKU sugerido se recalculan; las editadas se conservan. */
export function resuggest(rows: readonly VariantRow[], parentSku: string): VariantRow[] {
  return rows.map((row) => (row.skuEdited ? row : { ...row, sku: suggestedSku(parentSku, row) }));
}

/**
 * Agrega las combinaciones de tallas × colores × materiales que falten (spec F6 §7). Una lista
 * vacía no multiplica; sin ningún atributo no agrega nada.
 */
export function generateCombinations(
  rows: readonly VariantRow[],
  parentSku: string,
  lists: { sizes: readonly string[]; colors: readonly string[]; materials: readonly string[] },
): VariantRow[] {
  const axis = (values: readonly string[]) => (values.length > 0 ? values : ['']);
  if (lists.sizes.length + lists.colors.length + lists.materials.length === 0) return [...rows];
  const existing = new Set(rows.map(rowKey));
  const added: VariantRow[] = [];
  for (const size of axis(lists.sizes)) {
    for (const color of axis(lists.colors)) {
      for (const material of axis(lists.materials)) {
        const attrs = { size, color, material };
        const key = rowKey(attrs);
        if (existing.has(key)) continue;
        existing.add(key);
        added.push({
          key: newRowKey(),
          sku: suggestedSku(parentSku, attrs),
          skuEdited: false,
          ...attrs,
          price: '',
          barcode: '',
        });
      }
    }
  }
  return [...rows, ...added];
}

/** Valores distintos de un atributo, en el orden en que aparecen. */
export const distinctValues = (
  rows: readonly VariantRow[],
  field: 'size' | 'color' | 'material',
) => [...new Set(rows.map((row) => row[field].trim()).filter(Boolean))];
