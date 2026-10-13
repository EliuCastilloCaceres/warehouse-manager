import { type BranchDto, BranchUpdateInput } from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, TriangleAlert } from 'lucide-react';
import { type ComponentProps, memo, useCallback, useMemo, useState } from 'react';
import { type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranch } from '@/features/branch/BranchProvider';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { spanishErrors } from '@/shared/forms/zodErrors';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { branchKey, settingsApi, useBranchSettings } from './api';
import { BranchImageField } from './BranchImageField';
import { MEXICO_TIME_ZONES, otherTimeZones } from './timeZones';
import { formatPercent, type PreviewBranch, TicketPreview } from './TicketPreview';

interface FormValues {
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  imageUrl: string | null;
  logoUrl: string | null;
  ticketHeader: string;
  ticketFooterMessage: string;
  promoQrText: string;
  promoQrCaption: string;
  timezone: string;
  /** IVA en %, con hasta 2 decimales; se guarda en puntos base. */
  taxRatePercent: string;
  pricesIncludeTax: boolean;
  lowStockThreshold: string;
}
type Field = keyof FormValues;

const TEXT_FIELDS = [
  'name',
  'legalName',
  'taxId',
  'address',
  'phone',
  'email',
  'ticketHeader',
  'ticketFooterMessage',
  'promoQrText',
  'promoQrCaption',
] as const;

const TAX_MESSAGE = 'Escribe un porcentaje de 0 a 100, con hasta 2 decimales';
const THRESHOLD_MESSAGE = 'Escribe un número entero de unidades';
const SALES_NOTICE =
  'Aplica a ventas nuevas; las anteriores conservan su IVA. La zona horaria también cambia cómo se agrupan por día las ventas ya registradas en reportes y cortes.';

/** `"16"` → 1600, `"16.5"` → 1650; fuera de 0–100 o con más de 2 decimales → `null`. */
export function percentToBasisPoints(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  return bp <= 10000 ? bp : null;
}

const toCount = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);

function toFormValues(branch: BranchDto): FormValues {
  return {
    name: branch.name,
    legalName: branch.legalName ?? '',
    taxId: branch.taxId ?? '',
    address: branch.address ?? '',
    phone: branch.phone ?? '',
    email: branch.email ?? '',
    imageUrl: branch.imageUrl,
    logoUrl: branch.logoUrl,
    ticketHeader: branch.ticketHeader ?? '',
    ticketFooterMessage: branch.ticketFooterMessage ?? '',
    promoQrText: branch.promoQrText ?? '',
    promoQrCaption: branch.promoQrCaption ?? '',
    timezone: branch.timezone,
    taxRatePercent: formatPercent(branch.taxRateBp),
    pricesIncludeTax: branch.pricesIncludeTax,
    lowStockThreshold: String(branch.lowStockThreshold),
  };
}

/** Valores del formulario → objeto completo de `BranchUpdateInput` (sin validar). */
function toInput(values: FormValues) {
  const { taxRatePercent, lowStockThreshold, ...rest } = values;
  return {
    ...rest,
    taxRateBp: percentToBasisPoints(taxRatePercent) ?? -1,
    lowStockThreshold: toCount(lowStockThreshold) ?? -1,
  };
}

const FIELDS = new Set<string>([
  ...TEXT_FIELDS,
  'imageUrl',
  'logoUrl',
  'timezone',
  'taxRatePercent',
  'pricesIncludeTax',
  'lowStockThreshold',
] satisfies Field[]);

/** Campo del formulario de cada ruta del contrato (`details[].path` o `issue.path`). */
const fieldOf = (path: string): Field | null => {
  if (path === 'taxRateBp') return 'taxRatePercent';
  return FIELDS.has(path) ? (path as Field) : null;
};

/** Valida con `BranchUpdateInput` de `shared`; el IVA y el umbral se revisan antes de convertirse. */
const resolver: Resolver<FormValues> = async (values) => {
  const errors: Record<string, { type: string; message: string }> = {};
  const add = (field: Field | null, message: string) => {
    if (field) errors[field] ??= { type: 'validate', message };
  };
  if (percentToBasisPoints(values.taxRatePercent) === null) add('taxRatePercent', TAX_MESSAGE);
  if (toCount(values.lowStockThreshold) === null) add('lowStockThreshold', THRESHOLD_MESSAGE);
  const result = BranchUpdateInput.safeParse(toInput(values), { error: spanishErrors });
  if (!result.success) {
    for (const issue of result.error.issues)
      add(fieldOf(String(issue.path[0] ?? '')), issue.message);
  }
  return Object.keys(errors).length > 0
    ? { values: {}, errors: errors as FieldErrors<FormValues> }
    : { values, errors: {} };
};

interface TimeZoneFieldProps {
  value: string;
  /** Zona guardada: se ofrece aunque el navegador no la liste. */
  current: string;
  onChange: (tz: string) => void;
  error?: string;
}

/**
 * Zonas de México primero y luego "Otras" (spec F5 §3). Memorizado: son más de 400 opciones y
 * no deben volver a dibujarse en cada tecla del formulario.
 */
const TimeZoneField = memo(function TimeZoneField({
  value,
  current,
  onChange,
  error,
}: TimeZoneFieldProps) {
  const others = useMemo(() => otherTimeZones(current), [current]);
  return (
    <div className="space-y-1">
      <Label htmlFor="branch-timezone">Zona horaria</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="branch-timezone" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>México</SelectLabel>
            {MEXICO_TIME_ZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Otras</SelectLabel>
            {others.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
});

/** `/settings/branch`: datos de la sucursal actual con la vista previa del ticket (spec F5 §7). */
export function BranchSettingsForm() {
  const { branchId } = useBranch();
  const branch = useBranchSettings(branchId);
  if (branch.isError) {
    return (
      <ErrorState message={errorMessage(branch.error)} onRetry={() => void branch.refetch()} />
    );
  }
  if (!branch.data) return <LoadingState />;
  return <BranchForm key={branch.data.updatedAt} branch={branch.data} />;
}

function BranchForm({ branch }: { branch: BranchDto }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [previewOpen, setPreviewOpen] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm<FormValues>({ resolver, defaultValues: toFormValues(branch) });
  const values = useWatch({ control }) as FormValues;
  const setTimeZone = useCallback(
    (tz: string) => setValue('timezone', tz, { shouldDirty: true }),
    [setValue],
  );

  const preview: PreviewBranch = {
    code: branch.code,
    name: values.name,
    legalName: values.legalName || null,
    taxId: values.taxId.toUpperCase() || null,
    address: values.address || null,
    phone: values.phone || null,
    logoUrl: values.logoUrl,
    ticketHeader: values.ticketHeader || null,
    ticketFooterMessage: values.ticketFooterMessage || null,
    promoQrText: values.promoQrText || null,
    promoQrCaption: values.promoQrCaption || null,
    timezone: values.timezone,
    taxRateBp: percentToBasisPoints(values.taxRatePercent) ?? branch.taxRateBp,
    pricesIncludeTax: values.pricesIncludeTax,
  };
  const ticketPreview = <TicketPreview branch={preview} cashier={me!.user.fullName} />;
  const salesChanged =
    !!dirtyFields.taxRatePercent || !!dirtyFields.pricesIncludeTax || !!dirtyFields.timezone;

  const onSubmit = handleSubmit(async (formValues) => {
    const parsed = BranchUpdateInput.parse(toInput(formValues));
    const patch = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => {
        const field = key === 'taxRateBp' ? 'taxRatePercent' : (key as Field);
        return !!dirtyFields[field];
      }),
    );
    if (Object.keys(patch).length === 0) {
      notify.info('No hay cambios');
      return;
    }
    try {
      await settingsApi.updateBranch(branch.id, patch as BranchUpdateInput);
      notify.success('Ajustes guardados');
      await queryClient.invalidateQueries({ queryKey: branchKey(branch.id) });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        const details = Array.isArray(error.details)
          ? (error.details as { path?: string; message?: string }[])
          : [];
        let applied = false;
        for (const detail of details) {
          const field = fieldOf(detail.path?.split('.')[0] ?? '');
          if (field && detail.message) {
            setError(field, { type: 'server', message: detail.message });
            applied = true;
          }
        }
        if (applied) return;
      }
      notify.error(error);
    }
  });

  const text = (
    name: (typeof TEXT_FIELDS)[number] | 'lowStockThreshold' | 'taxRatePercent',
    label: string,
    props: ComponentProps<'input'> & { hint?: string } = {},
  ) => {
    const { hint, ...inputProps } = props;
    return (
      <div className="space-y-1">
        <Label htmlFor={`branch-${name}`}>{label}</Label>
        <Input
          id={`branch-${name}`}
          aria-invalid={!!errors[name]}
          autoComplete="off"
          {...inputProps}
          {...register(name)}
        />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-1 flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">Datos generales</legend>
          <div className="space-y-1">
            <Label htmlFor="branch-code">Código</Label>
            <Input
              id="branch-code"
              value={branch.code}
              readOnly
              aria-describedby="branch-code-hint"
            />
            <p id="branch-code-hint" className="text-xs text-muted-foreground">
              No editable: es el prefijo de los folios.
            </p>
          </div>
          {text('name', 'Nombre')}
          {text('legalName', 'Razón social')}
          {text('taxId', 'RFC', { autoCapitalize: 'characters' })}
          {text('address', 'Dirección')}
          <div className="grid gap-3 sm:grid-cols-2">
            {text('phone', 'Teléfono', { type: 'tel' })}
            {text('email', 'Correo', { type: 'email' })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">Imágenes</legend>
          {(['imageUrl', 'logoUrl'] as const).map((name) => (
            <BranchImageField
              key={name}
              id={`branch-${name}`}
              label={name === 'imageUrl' ? 'Foto' : 'Logo'}
              value={values[name]}
              onChange={(url) => setValue(name, url, { shouldDirty: true })}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">Ticket</legend>
          {text('ticketHeader', 'Encabezado')}
          {text('ticketFooterMessage', 'Mensaje final')}
          {text('promoQrText', 'Texto del QR de promoción', {
            hint: 'Se convierte en QR. Un enlace (https://…) se abre con la cámara del celular.',
          })}
          {text('promoQrCaption', 'Descripción del QR', { hint: 'Se imprime debajo del QR.' })}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">Operación</legend>
          <TimeZoneField
            value={values.timezone}
            current={branch.timezone}
            onChange={setTimeZone}
            error={errors.timezone?.message}
          />
          {text('taxRatePercent', 'IVA (%)', { inputMode: 'decimal' })}
          <label className="flex min-h-11 items-center gap-3">
            <Checkbox
              checked={values.pricesIncludeTax}
              onCheckedChange={(checked) =>
                setValue('pricesIncludeTax', checked === true, { shouldDirty: true })
              }
            />
            Los precios incluyen IVA
          </label>
          {salesChanged && (
            <p className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{SALES_NOTICE}</span>
            </p>
          )}
          {text('lowStockThreshold', 'Stock bajo (unidades)', { inputMode: 'numeric' })}
        </fieldset>

        <div className="sticky bottom-[calc(3rem+env(safe-area-inset-bottom))] flex gap-2 border-t bg-background py-3 md:bottom-0">
          {!isDesktop && (
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye />
              Vista previa
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting} className="flex-1 md:flex-none">
            Guardar
          </Button>
        </div>
      </form>

      {isDesktop ? (
        <aside aria-label="Vista previa del ticket" className="sticky top-4 w-[90mm] shrink-0">
          {ticketPreview}
        </aside>
      ) : (
        <ResponsiveDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title="Vista previa del ticket"
        >
          <div className="max-h-[70dvh] overflow-y-auto pb-4">{ticketPreview}</div>
        </ResponsiveDialog>
      )}
    </div>
  );
}
