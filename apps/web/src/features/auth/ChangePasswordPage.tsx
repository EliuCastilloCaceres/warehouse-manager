import { zodResolver } from '@hookform/resolvers/zod';
import { AuthSessionDto, ChangePasswordInput } from '@warehouse-manager/shared';
import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { apiFetch } from '@/shared/api/apiClient';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { applyServerErrors, spanishErrors } from '@/shared/forms/zodErrors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { useAuth } from './AuthProvider';
import { safeNext } from './safeNext';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const contractResolver = zodResolver(ChangePasswordInput, { error: spanishErrors });

/**
 * El contrato de `shared` valida la contraseña nueva; la confirmación es solo del formulario
 * (regla `validate`: "Las contraseñas no coinciden").
 */
const resolver: Resolver<FormValues> = async (values, context, options) => {
  const result = await contractResolver(values, context, options as never);
  const errors = { ...result.errors } as Record<string, unknown>;
  if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = { type: 'validate', message: 'Las contraseñas no coinciden' };
  }
  return Object.keys(errors).length > 0
    ? { values: {}, errors: errors as never }
    : { values, errors: {} };
};

const FIELDS = ['currentPassword', 'newPassword', 'confirmPassword'] as const;

export function ChangePasswordPage() {
  const { applySession, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver,
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setServerError(null);
    try {
      const session = await apiFetch('/api/v1/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
        schema: AuthSessionDto,
      });
      applySession(session);
      notify.success('Contraseña actualizada');
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUTH_PASSWORD_INCORRECT') {
        setError('currentPassword', { type: 'server', message: error.message });
      } else if (!applyServerErrors(error, setError, FIELDS)) {
        setServerError(errorMessage(error));
      }
    }
  });

  const field = (name: (typeof FIELDS)[number], label: string, autoComplete: string) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={!!errors[name]}
        {...register(name)}
      />
      {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Cambia tu contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Por seguridad, debes cambiar tu contraseña para continuar.
          </p>
        </div>
        {field('currentPassword', 'Contraseña actual', 'current-password')}
        {field('newPassword', 'Nueva contraseña', 'new-password')}
        {field('confirmPassword', 'Confirmar nueva contraseña', 'new-password')}
        {serverError && (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          Guardar contraseña
        </Button>
        <Button type="button" variant="link" className="w-full" onClick={() => void logout()}>
          Cerrar sesión
        </Button>
      </form>
    </main>
  );
}
