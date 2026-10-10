import { zodResolver } from '@hookform/resolvers/zod';
import { AuthSessionDto, LoginInput } from '@warehouse-manager/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { apiFetch } from '@/shared/api/apiClient';
import { errorMessage } from '@/shared/api/errors';
import { applyServerErrors, spanishErrors } from '@/shared/forms/zodErrors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { useAuth } from './AuthProvider';
import { safeNext } from './safeNext';

export function LoginPage() {
  const { session, applySession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(LoginInput, { error: spanishErrors }),
    defaultValues: { username: '', password: '' },
  });

  if (session) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: values,
        schema: AuthSessionDto,
      });
      applySession(result);
      // Los guards llevan al cambio de contraseña o al selector de sucursal si hace falta.
      navigate(next, { replace: true });
    } catch (error) {
      if (!applyServerErrors(error, setError, ['username', 'password'])) {
        setServerError(errorMessage(error));
      }
    }
  });

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-xl font-semibold">warehouse-manager</h1>
        <div className="space-y-1">
          <Label htmlFor="username">Usuario</Label>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            aria-invalid={!!errors.username}
            {...register('username')}
          />
          {errors.username && <p className="text-sm text-destructive">{errors.username.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Contraseña</Label>
          <div className="flex gap-2">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </div>
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>
        {serverError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Iniciar sesión'}
        </Button>
      </form>
    </main>
  );
}
