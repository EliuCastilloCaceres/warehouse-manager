import { PasswordPolicy, type UserDetailDto } from '@warehouse-manager/shared';
import { KeyRound, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { ConfirmDialog, ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { useInvalidateUsers, usersApi } from './api';
import { type Credentials, CredentialsDialog } from './CredentialsDialog';
import { FieldError } from './fields';

type PasswordMode = 'generate' | 'manual';

/** Restablecer contraseña, desactivar y reactivar (spec F4 §7). Los errores van a un *toast*. */
export function UserActions({ user }: { user: UserDetailDto }) {
  const invalidate = useInvalidateUsers();
  const [confirming, setConfirming] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
      await invalidate();
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = () =>
    void run(
      () => (user.isActive ? usersApi.deactivate(user.id) : usersApi.reactivate(user.id)),
      user.isActive ? 'Usuario desactivado' : 'Usuario reactivado',
    );

  const openReset = () => {
    setMode('generate');
    setPassword('');
    setPasswordError(undefined);
    setResetOpen(true);
  };

  const submitReset = async () => {
    if (mode === 'manual') {
      const parsed = PasswordPolicy.safeParse(password);
      if (!parsed.success) {
        setPasswordError(parsed.error.issues[0]?.message);
        return;
      }
    }
    setBusy(true);
    try {
      const result = await usersApi.resetPassword(
        user.id,
        mode === 'manual' ? { mode, value: password } : { mode },
      );
      setResetOpen(false);
      if (result.generatedPassword) {
        setCredentials({
          fullName: user.fullName,
          username: user.username,
          password: result.generatedPassword,
        });
      } else {
        notify.success('Contraseña restablecida. Se pedirá cambiarla al iniciar sesión.');
      }
      await invalidate();
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={openReset} disabled={busy}>
        <KeyRound />
        Restablecer contraseña
      </Button>
      <Button
        variant={user.isActive ? 'destructive' : 'outline'}
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        {user.isActive ? <UserX /> : <UserCheck />}
        {user.isActive ? 'Desactivar' : 'Reactivar'}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={user.isActive ? `¿Desactivar a ${user.fullName}?` : `¿Reactivar a ${user.fullName}?`}
        description={user.isActive ? 'Se cerrarán sus sesiones.' : 'Podrá volver a iniciar sesión.'}
        confirmLabel={user.isActive ? 'Desactivar' : 'Reactivar'}
        destructive={user.isActive}
        onConfirm={toggleActive}
      />

      <ResponsiveDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={`Restablecer contraseña de ${user.fullName}`}
        description="Se cerrarán sus sesiones y deberá cambiarla al iniciar sesión."
        footer={
          <>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void submitReset()} disabled={busy}>
              Restablecer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <RadioGroup
            aria-label="Modo de contraseña"
            value={mode}
            onValueChange={(value) => setMode(value as PasswordMode)}
            className="gap-0"
          >
            {(
              [
                ['generate', 'Generar automáticamente'],
                ['manual', 'Escribirla'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={value} />
                {label}
              </label>
            ))}
          </RadioGroup>
          {mode === 'manual' && (
            <div className="space-y-1">
              <Label htmlFor="reset-password">Contraseña nueva</Label>
              <Input
                id="reset-password"
                type="text"
                autoComplete="off"
                value={password}
                aria-invalid={!!passwordError}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError(undefined);
                }}
              />
              <FieldError message={passwordError} />
            </div>
          )}
        </div>
      </ResponsiveDialog>

      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}
