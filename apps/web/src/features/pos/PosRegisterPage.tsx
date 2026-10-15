import { parseMoney, type PosRegisterDto } from '@warehouse-manager/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Can } from '@/features/auth/guards';
import { safeNext } from '@/features/auth/safeNext';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { DEFAULT_TIME_ZONE, formatTime } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { posApi, useDeviceSession, usePosBranch, usePosRegisters } from './api';
import { MoneyInput, PosBackLink, firstName } from './components';

function OpenRegisterDialog({
  register,
  onClose,
  onOpened,
}: {
  register: PosRegisterDto | null;
  onClose: () => void;
  onOpened: (register: PosRegisterDto, sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const openingAmount = amount.trim() === '' ? 0 : parseMoney(amount);
  const open = useMutation({
    mutationFn: () =>
      posApi.openSession({ cashRegisterId: register!.id, openingAmount: openingAmount! }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['pos-registers'] });
      setAmount('');
      onOpened(register!, session.id);
    },
    onError: (error) => {
      notify.error(error);
      if (error instanceof ApiError && error.code === 'CASH_SESSION_ALREADY_OPEN') {
        void queryClient.invalidateQueries({ queryKey: ['pos-registers'] });
        onClose();
      }
    },
  });
  return (
    <ResponsiveDialog
      open={!!register}
      onOpenChange={(value) => !value && onClose()}
      title={register ? `Abrir ${register.code} · ${register.name}` : ''}
      description="Captura el fondo inicial de la caja."
      footer={
        <Button
          className="h-12"
          disabled={openingAmount === null || open.isPending}
          onClick={() => open.mutate()}
        >
          Abrir caja
        </Button>
      }
    >
      <MoneyInput
        label="Fondo inicial"
        value={amount}
        onChange={setAmount}
        invalid={openingAmount === null}
        autoFocus
      />
    </ResponsiveDialog>
  );
}

/**
 * `/pos/register?next=`: la caja desde la que cobra el dispositivo. Una abierta se elige con
 * "Cobrar en esta caja"; una cerrada se abre (con `pos.session.open`) capturando el fondo.
 */
export function PosRegisterPage() {
  const [params] = useSearchParams();
  const next = params.get('next') ? safeNext(params.get('next')) : '/pos';
  const navigate = useNavigate();
  const registers = usePosRegisters();
  const branch = usePosBranch();
  const device = useDeviceSession();
  const [opening, setOpening] = useState<PosRegisterDto | null>(null);
  const timeZone = branch.data?.timezone ?? DEFAULT_TIME_ZONE;

  const chargeHere = (register: PosRegisterDto, sessionId: string) => {
    device.save({ registerId: register.id, sessionId });
    navigate(next);
  };

  return (
    <section className="flex flex-col gap-4">
      <PosBackLink />
      <h1 className="text-xl font-semibold">¿Desde qué caja cobras?</h1>
      {registers.isPending && <LoadingState />}
      {registers.error && (
        <ErrorState
          message={errorMessage(registers.error)}
          onRetry={() => void registers.refetch()}
        />
      )}
      {registers.data && (
        <ul aria-label="Cajas" className="flex flex-col divide-y rounded-md border">
          {registers.data.map((register) => (
            <li key={register.id} className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-2">
              <div className="flex flex-1 flex-col">
                <span className="font-medium">
                  {register.code} · {register.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {register.openSession
                    ? `Abierta por ${firstName(register.openSession.openedBy.fullName)} ${formatTime(
                        register.openSession.openedAt,
                        timeZone,
                      )}`
                    : 'Cerrada'}
                </span>
              </div>
              {register.openSession ? (
                <Button
                  className="h-12"
                  onClick={() => chargeHere(register, register.openSession!.id)}
                >
                  Cobrar en esta caja
                </Button>
              ) : (
                <Can perm="pos.session.open">
                  <Button className="h-12" variant="outline" onClick={() => setOpening(register)}>
                    Abrir
                  </Button>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}
      <OpenRegisterDialog
        register={opening}
        onClose={() => setOpening(null)}
        onOpened={(register, sessionId) => {
          setOpening(null);
          chargeHere(register, sessionId);
        }}
      />
    </section>
  );
}
