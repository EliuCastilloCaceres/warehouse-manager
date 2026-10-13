import { zodResolver } from '@hookform/resolvers/zod';
import { type CashRegisterDto, CashRegisterUpdateInput } from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useBranch } from '@/features/branch/BranchProvider';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { spanishErrors } from '@/shared/forms/zodErrors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states';
import { cashRegistersKey, settingsApi, useCashRegisters } from './api';

const DUPLICATE_CODE = 'Ya existe una caja con ese código';

/** `/settings/registers`: las cajas de la sucursal actual; solo se editan (spec F5 §7). */
export function CashRegistersTab() {
  const { branchId } = useBranch();
  const registers = useCashRegisters(branchId);
  const [editing, setEditing] = useState<CashRegisterDto | null>(null);

  let list;
  if (registers.isError) {
    list = (
      <ErrorState
        message={errorMessage(registers.error)}
        onRetry={() => void registers.refetch()}
      />
    );
  } else if (!registers.data) {
    list = <LoadingState />;
  } else if (registers.data.length === 0) {
    list = <EmptyState message="Esta sucursal no tiene cajas." />;
  } else {
    list = (
      <ul aria-label="Cajas" className="divide-y rounded-md border">
        {registers.data.map((register) => (
          <li key={register.id} className="flex min-h-14 items-center justify-between gap-2 px-3">
            <span>
              <span className="font-medium">{register.code}</span> · {register.name}
            </span>
            <Button
              variant="ghost"
              aria-label={`Editar ${register.code}`}
              onClick={() => setEditing(register)}
            >
              <Pencil />
              Editar
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Cajas</h2>
      {list}
      <p className="text-sm text-muted-foreground">No se pueden agregar ni eliminar cajas.</p>
      {editing && (
        <EditRegisterDialog key={editing.id} register={editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function EditRegisterDialog({
  register,
  onClose,
}: {
  register: CashRegisterDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm({
    resolver: zodResolver(CashRegisterUpdateInput, { error: spanishErrors }),
    defaultValues: { code: register.code, name: register.name },
  });

  const onSubmit = handleSubmit(async (values) => {
    const patch = {
      ...(dirtyFields.code ? { code: values.code } : {}),
      ...(dirtyFields.name ? { name: values.name } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      await settingsApi.updateCashRegister(register.id, patch);
      notify.success('Caja actualizada');
      await queryClient.invalidateQueries({ queryKey: cashRegistersKey(register.branchId) });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setError('code', { type: 'server', message: DUPLICATE_CODE });
      } else {
        notify.error(error);
      }
    }
  });

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Editar caja ${register.code}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="register-form" disabled={isSubmitting}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="register-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        {(
          [
            ['code', 'Código', { autoCapitalize: 'characters' }],
            ['name', 'Nombre', {}],
          ] as const
        ).map(([name, label, props]) => (
          <div key={name} className="space-y-1">
            <Label htmlFor={`register-${name}`}>{label}</Label>
            <Input
              id={`register-${name}`}
              autoComplete="off"
              aria-invalid={!!errors[name]}
              {...props}
              {...field(name)}
            />
            {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
          </div>
        ))}
      </form>
    </ResponsiveDialog>
  );
}
