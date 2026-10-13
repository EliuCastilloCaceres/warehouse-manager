import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ChipsInput } from './ChipsInput';
import { distinctValues, generateCombinations, type VariantRow } from './variantRows';

export interface VariantMatrixGeneratorProps {
  parentSku: string;
  rows: readonly VariantRow[];
  onChange: (rows: VariantRow[]) => void;
  disabled?: boolean;
}

export const NO_NEW_COMBINATIONS = 'No hay combinaciones nuevas: ya están todas en la tabla.';
export const MISSING_PARENT_SKU =
  'Escribe el SKU del producto para sugerir el SKU de cada variante.';

/** Resultado de generar, para el aviso y el mensaje junto al botón. */
export function generatedMessage(added: number): string {
  if (added === 0) return NO_NEW_COMBINATIONS;
  return added === 1 ? 'Se agregó 1 variante.' : `Se agregaron ${added} variantes.`;
}

/** Tallas × colores × materiales: "Generar combinaciones" agrega solo las que faltan. */
export function VariantMatrixGenerator({
  parentSku,
  rows,
  onChange,
  disabled,
}: VariantMatrixGeneratorProps) {
  const [sizes, setSizes] = useState(() => distinctValues(rows, 'size'));
  const [colors, setColors] = useState(() => distinctValues(rows, 'color'));
  const [materials, setMaterials] = useState(() => distinctValues(rows, 'material'));
  const [status, setStatus] = useState<string | null>(null);
  const empty = sizes.length + colors.length + materials.length === 0;

  const generate = () => {
    const next = generateCombinations(rows, parentSku, { sizes, colors, materials });
    const added = next.length - rows.length;
    onChange(next);
    const message = generatedMessage(added);
    const hint = added > 0 && !parentSku.trim() ? ` ${MISSING_PARENT_SKU}` : '';
    setStatus(`${message}${hint}`);
    if (added > 0) notify.success(message);
    else notify.info(message);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <ChipsInput
        id="matrix-sizes"
        label="Tallas"
        values={sizes}
        onChange={setSizes}
        disabled={disabled}
        placeholder="23.5"
      />
      <ChipsInput
        id="matrix-colors"
        label="Colores"
        values={colors}
        onChange={setColors}
        disabled={disabled}
        placeholder="Negro"
      />
      <ChipsInput
        id="matrix-materials"
        label="Materiales"
        values={materials}
        onChange={setMaterials}
        disabled={disabled}
        placeholder="Piel"
      />
      {!disabled && (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={empty}
            onClick={generate}
          >
            <Wand2 />
            Generar combinaciones
          </Button>
          {empty ? (
            <p className="text-sm text-muted-foreground">
              Agrega al menos una talla, un color o un material.
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
