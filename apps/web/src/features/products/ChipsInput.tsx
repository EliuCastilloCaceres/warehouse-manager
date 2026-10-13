import { X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

export interface ChipsInputProps {
  id: string;
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

/** Lista de valores cortos: Enter o "Agregar" suma uno (sin repetir, sin mayúsculas); ✕ lo quita. */
export function ChipsInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  maxLength = 40,
  disabled,
}: ChipsInputProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!values.some((v) => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    }
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {values.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-1">
          {values.map((value) => (
            <li
              key={value}
              className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-3 text-sm"
            >
              {value}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Quitar ${value}`}
                  className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="button" variant="outline" onClick={add} aria-label={`Agregar a ${label}`}>
            Agregar
          </Button>
        </div>
      )}
    </div>
  );
}
