import { ImageIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { settingsApi } from './api';

export interface BranchImageFieldProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

/**
 * Foto o logo de la sucursal: el archivo se sube con `POST /uploads/branch-images` y el campo
 * guarda la `url`; se persiste al guardar el formulario. "Quitar" deja el campo en `null`.
 */
export function BranchImageField({ id, label, value, onChange, disabled }: BranchImageFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const image = await settingsApi.uploadBranchImage(file);
      onChange(image.url);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {value ? (
            <img src={value} alt={label} className="size-full object-contain" />
          ) : (
            <ImageIcon aria-hidden className="size-6 text-muted-foreground" />
          )}
        </div>
        <input
          id={id}
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? 'Subiendo…' : 'Cambiar'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            Quitar
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
