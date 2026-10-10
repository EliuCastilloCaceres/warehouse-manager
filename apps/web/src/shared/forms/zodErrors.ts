import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/shared/api/errors';

interface Issue {
  code: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  input?: unknown;
}

/**
 * Mensajes en español para los errores de Zod sin mensaje propio (los contratos de `shared`
 * que sí lo definen, como `PasswordPolicy`, lo conservan). Se pasa a `zodResolver`.
 */
export function spanishErrors(issue: Issue): string | undefined {
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return Number(issue.minimum) <= 1
      ? 'Este campo es obligatorio'
      : `Debe tener al menos ${issue.minimum} caracteres`;
  }
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `Debe tener como máximo ${issue.maximum} caracteres`;
  }
  if (issue.code === 'invalid_type' && issue.input === undefined)
    return 'Este campo es obligatorio';
  return 'Valor inválido';
}

/** Asigna un `VALIDATION_ERROR` del servidor a los campos por `details[].path`. */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return false;
  const details = Array.isArray(error.details)
    ? (error.details as { path?: string; message?: string }[])
    : [];
  let applied = false;
  for (const detail of details) {
    const field = fields.find((f) => f === detail.path);
    if (field && detail.message) {
      setError(field, { type: 'server', message: detail.message });
      applied = true;
    }
  }
  return applied;
}
