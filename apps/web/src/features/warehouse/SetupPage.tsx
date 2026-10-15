import {
  type ContainerNodeDto,
  LOCATION_COLORS,
  type LocationColor,
  type RackNodeDto,
  type ZoneNodeDto,
} from '@warehouse-manager/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, Lock, MoreVertical, Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { ConfirmDialog, ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { type NodeKind, structureApi, useWarehouse, useWarehouseTree } from './api';
import { ColorDot } from './components';
import { BackLink } from './WarehouseHomePage';

export const reprintMessage = (racks: number) =>
  `Reimprime las etiquetas de ${racks} ${racks === 1 ? 'rack' : 'racks'}. Si reutilizas el código anterior, las etiquetas viejas apuntarán al rack nuevo.`;
export const overCapacityMessage = (occupied: number, capacity: number) =>
  `La capacidad queda por debajo de la ocupación (${occupied} > ${capacity}): el rack no recibirá más stock sin permiso para exceder la capacidad.`;

// ─── Campos ──────────────────────────────────────────────────────────────────

/** Paleta de colores con su nombre (spec F7 §3). */
export function ColorPalette({
  value,
  onChange,
  noneLabel = 'Sin color',
}: {
  value: string | null;
  onChange: (hex: LocationColor | null) => void;
  noneLabel?: string;
}) {
  const options: [LocationColor | null, string][] = [
    [null, noneLabel],
    ...LOCATION_COLORS.map((c) => [c.hex, c.name] as [LocationColor, string]),
  ];
  return (
    <div role="radiogroup" aria-label="Color" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map(([hex, name]) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === hex}
          onClick={() => onChange(hex)}
          className={cn(
            'flex min-h-11 items-center gap-2 rounded-md border px-2 text-left text-sm',
            value === hex && 'border-primary ring-2 ring-primary/40',
          )}
        >
          <ColorDot hex={hex} />
          {name}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

const toInt = (value: string) => (value.trim() === '' ? NaN : Number(value));

// ─── Formularios ─────────────────────────────────────────────────────────────

type FormState =
  | { type: 'zone'; zone?: ZoneNodeDto }
  | { type: 'container'; zone: ZoneNodeDto; container?: ContainerNodeDto }
  | { type: 'rack'; zone: ZoneNodeDto; container: ContainerNodeDto; rack?: RackNodeDto }
  | { type: 'zone-batch'; zone: ZoneNodeDto }
  | { type: 'rack-batch'; zone: ZoneNodeDto; container: ContainerNodeDto }
  | { type: 'code'; kind: NodeKind; id: string; current: string; racks: number };

function NodeForm({
  form,
  warehouseId,
  onDone,
}: {
  form: FormState;
  warehouseId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(
    form.type === 'zone'
      ? (form.zone?.name ?? '')
      : form.type === 'container'
        ? (form.container?.name ?? '')
        : '',
  );
  const [code, setCode] = useState('');
  const [color, setColor] = useState(
    (form.type === 'zone'
      ? (form.zone?.color ?? null)
      : form.type === 'rack'
        ? (form.rack?.labelColor ?? null)
        : null) as LocationColor | null,
  );
  const [priority, setPriority] = useState(
    String(form.type === 'zone' ? (form.zone?.priority ?? 0) : 0),
  );
  const [capacity, setCapacity] = useState(
    form.type === 'rack' && form.rack ? String(form.rack.capacityUnits) : '',
  );
  const [count, setCount] = useState('1');
  const [racksPer, setRacksPer] = useState('');
  const [confirmCode, setConfirmCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const editing =
    (form.type === 'zone' && !!form.zone) ||
    (form.type === 'container' && !!form.container) ||
    (form.type === 'rack' && !!form.rack);
  const occupied = form.type === 'rack' ? (form.rack?.occupancy.occupied ?? 0) : 0;
  const lowCapacity = form.type === 'rack' && !!form.rack && toInt(capacity) < occupied;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      const result = await action();
      notify.success(success);
      if (result && typeof result === 'object' && 'overCapacity' in result && result.overCapacity) {
        notify.info(overCapacityMessage(occupied, toInt(capacity)));
      }
      onDone();
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const optionalCode = code.trim() ? { code: code.trim() } : {};

  const submit = () => {
    switch (form.type) {
      case 'zone': {
        const data = { name, color, priority: toInt(priority) || 0 };
        return run(
          () =>
            form.zone
              ? structureApi.updateZone(form.zone.id, data)
              : structureApi.createZone(warehouseId, { ...data, ...optionalCode }),
          form.zone ? 'Zona guardada' : 'Zona creada',
        );
      }
      case 'container':
        return run(
          () =>
            form.container
              ? structureApi.updateContainer(form.container.id, { name })
              : structureApi.createContainer(form.zone.id, { name, ...optionalCode }),
          form.container ? 'Contenedor guardado' : 'Contenedor creado',
        );
      case 'rack': {
        const data = { capacityUnits: toInt(capacity), labelColor: color };
        return run(
          () =>
            form.rack
              ? structureApi.updateRack(form.rack.id, data)
              : structureApi.createRack(form.container.id, { ...data, ...optionalCode }),
          form.rack ? 'Rack guardado' : 'Rack creado',
        );
      }
      case 'zone-batch':
        return run(
          () =>
            structureApi.createContainers(form.zone.id, {
              count: toInt(count),
              ...(racksPer.trim()
                ? { racksPerContainer: toInt(racksPer), capacityUnits: toInt(capacity) }
                : {}),
              labelColor: color,
            }),
          'Contenedores creados',
        );
      case 'rack-batch':
        return run(
          () =>
            structureApi.createRacks(form.container.id, {
              count: toInt(count),
              capacityUnits: toInt(capacity),
              labelColor: color,
            }),
          'Racks creados',
        );
      case 'code':
        return setConfirmCode(true);
    }
  };

  const saveCode = () => {
    if (form.type !== 'code') return;
    const patch = { code: code.trim() };
    void run(
      () =>
        form.kind === 'zone'
          ? structureApi.updateZone(form.id, patch)
          : form.kind === 'container'
            ? structureApi.updateContainer(form.id, patch)
            : structureApi.updateRack(form.id, patch),
      'Código actualizado',
    );
  };

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {form.type === 'code' && (
        <Field label={`Nuevo código (actual: ${form.current})`}>
          {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
      )}
      {!editing && ['zone', 'container', 'rack'].includes(form.type) && (
        <Field label="Código (opcional)">
          {(id) => (
            <Input
              id={id}
              placeholder="Siguiente libre"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
      )}
      {(form.type === 'zone' || form.type === 'container') && (
        <Field label="Nombre">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      )}
      {form.type === 'zone' && (
        <Field label="Prioridad (menor = preferida)">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          )}
        </Field>
      )}
      {(form.type === 'zone-batch' || form.type === 'rack-batch') && (
        <Field label={form.type === 'zone-batch' ? 'Contenedores' : 'Racks'}>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          )}
        </Field>
      )}
      {form.type === 'zone-batch' && (
        <Field label="Racks por contenedor">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={racksPer}
              onChange={(e) => setRacksPer(e.target.value)}
            />
          )}
        </Field>
      )}
      {(form.type === 'rack' || form.type === 'rack-batch' || form.type === 'zone-batch') && (
        <Field label="Capacidad (unidades)">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          )}
        </Field>
      )}
      {lowCapacity && (
        <p role="alert" className="text-sm text-amber-700">
          {overCapacityMessage(occupied, toInt(capacity))}
        </p>
      )}
      {form.type !== 'container' && form.type !== 'code' && (
        <ColorPalette
          value={color}
          onChange={setColor}
          noneLabel={form.type === 'zone' ? 'Sin color' : 'Color de la zona'}
        />
      )}
      <Button type="submit" className="h-14" disabled={busy}>
        Guardar
      </Button>
      {form.type === 'code' && (
        <ConfirmDialog
          open={confirmCode}
          onOpenChange={setConfirmCode}
          title="¿Cambiar el código?"
          description={reprintMessage(form.racks)}
          confirmLabel="Cambiar código"
          onConfirm={saveCode}
        />
      )}
    </form>
  );
}

const FORM_TITLE: Record<FormState['type'], string> = {
  zone: 'Zona',
  container: 'Contenedor',
  rack: 'Rack',
  'zone-batch': 'Crear contenedores en lote',
  'rack-batch': 'Crear racks en lote',
  code: 'Editar código',
};

// ─── Menú del nodo ───────────────────────────────────────────────────────────

interface MenuTarget {
  kind: NodeKind;
  id: string;
  label: string;
  code: string;
  isActive: boolean;
  racks: number;
  edit: FormState;
}

function NodeMenu({
  target,
  onClose,
  onForm,
}: {
  target: MenuTarget;
  onClose: () => void;
  onForm: (form: FormState) => void;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null);

  const act = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      notify.success(success);
      await queryClient.invalidateQueries({ queryKey: ['warehouse-tree'] });
      onClose();
    } catch (error) {
      const codes =
        error instanceof ApiError && error.code === 'RACK_HAS_STOCK'
          ? ((error.details as { locationCodes?: string[] } | undefined)?.locationCodes ?? [])
          : [];
      notify.error(codes.length > 0 ? `${errorMessage(error)} ${codes.join(', ')}` : error);
    }
  };

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()} title={target.label}>
      <div className="flex flex-col gap-2 pb-4">
        <Button variant="outline" className="h-12" onClick={() => onForm(target.edit)}>
          Editar
        </Button>
        <Button
          variant="outline"
          className="h-12"
          onClick={() =>
            onForm({
              type: 'code',
              kind: target.kind,
              id: target.id,
              current: target.code,
              racks: target.racks,
            })
          }
        >
          Editar código
        </Button>
        {target.isActive ? (
          <Button variant="outline" className="h-12" onClick={() => setConfirm('deactivate')}>
            Desactivar
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-12"
            onClick={() =>
              void act(() => structureApi.setActive(target.kind, target.id, true), 'Reactivado')
            }
          >
            Reactivar
          </Button>
        )}
        <Button variant="destructive" className="h-12" onClick={() => setConfirm('delete')}>
          Eliminar
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`¿Desactivar ${target.label}?`}
        description="También se desactiva lo que contiene. Solo se puede si no tiene stock."
        confirmLabel="Desactivar"
        onConfirm={() =>
          void act(() => structureApi.setActive(target.kind, target.id, false), 'Desactivado')
        }
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`¿Eliminar ${target.label}?`}
        description="Solo se puede si nunca tuvo movimientos; si no, desactívalo."
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => void act(() => structureApi.remove(target.kind, target.id), 'Eliminado')}
      />
    </ResponsiveDialog>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label={`Opciones de ${label}`} onClick={onClick}>
      <MoreVertical />
    </Button>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

/** `/warehouse/setup`: árbol editable de zonas, contenedores y racks (spec F7 §8). */
export function SetupPage() {
  const queryClient = useQueryClient();
  const { warehouse } = useWarehouse();
  const tree = useWarehouseTree(warehouse?.id, { includeInactive: true });
  const [form, setForm] = useState<FormState | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  if (tree.error) {
    return <ErrorState message={errorMessage(tree.error)} onRetry={() => void tree.refetch()} />;
  }
  if (!tree.data || !warehouse) return <LoadingState />;

  const done = () => {
    setForm(null);
    void queryClient.invalidateQueries({ queryKey: ['warehouse-tree'] });
  };
  const inactive = (isActive: boolean) =>
    isActive ? null : <span className="text-xs">(inactivo)</span>;

  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Configurar almacén</h1>
        <Button onClick={() => setForm({ type: 'zone' })}>
          <Plus />
          Zona
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
        <Lock aria-label="Bloqueada" className="size-4" />
        <span className="font-mono">{tree.data.staging.locationCode}</span>
        <span className="text-sm text-muted-foreground">Staging: no se edita</span>
      </div>

      <ul aria-label="Estructura" className="flex flex-col gap-3">
        {tree.data.zones.map((zone) => {
          const zoneRacks = zone.containers.reduce((sum, c) => sum + c.racks.length, 0);
          return (
            <li key={zone.id} className={cn('rounded-md border', !zone.isActive && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <ColorDot hex={zone.color} />
                <span className="font-medium">
                  {zone.code} · {zone.name}
                </span>
                <span className="text-xs text-muted-foreground">Prioridad {zone.priority}</span>
                {inactive(zone.isActive)}
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ type: 'container', zone })}
                  >
                    <Plus />
                    Contenedor
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ type: 'zone-batch', zone })}
                  >
                    <Layers />
                    Crear en lote
                  </Button>
                  <MenuButton
                    label={`zona ${zone.code}`}
                    onClick={() =>
                      setMenu({
                        kind: 'zone',
                        id: zone.id,
                        label: `zona ${zone.code}`,
                        code: zone.code,
                        isActive: zone.isActive,
                        racks: zoneRacks,
                        edit: { type: 'zone', zone },
                      })
                    }
                  />
                </span>
              </div>
              <ul className="flex flex-col gap-2 px-3 pb-3">
                {zone.containers.map((container) => {
                  const code = `${zone.code}-${container.code}`;
                  return (
                    <li
                      key={container.id}
                      className={cn('rounded-md border', !container.isActive && 'opacity-60')}
                    >
                      <div className="flex flex-wrap items-center gap-2 p-2">
                        <span className="font-mono">{code}</span>
                        {container.name && <span>{container.name}</span>}
                        {inactive(container.isActive)}
                        <span className="ml-auto flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setForm({ type: 'rack', zone, container })}
                          >
                            <Plus />
                            Rack
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setForm({ type: 'rack-batch', zone, container })}
                          >
                            <Layers />
                            Racks en lote
                          </Button>
                          <MenuButton
                            label={`contenedor ${code}`}
                            onClick={() =>
                              setMenu({
                                kind: 'container',
                                id: container.id,
                                label: `contenedor ${code}`,
                                code: container.code,
                                isActive: container.isActive,
                                racks: container.racks.length,
                                edit: { type: 'container', zone, container },
                              })
                            }
                          />
                        </span>
                      </div>
                      <ul className="flex flex-col divide-y border-t">
                        {container.racks.map((rack) => (
                          <li
                            key={rack.id}
                            className={cn(
                              'flex items-center gap-2 px-2 py-1',
                              !rack.isActive && 'opacity-60',
                            )}
                          >
                            <ColorDot hex={rack.colorHex} />
                            <span className="font-mono text-sm">{rack.locationCode}</span>
                            <span className="text-sm text-muted-foreground">
                              {rack.occupancy.occupied}/{rack.capacityUnits}
                            </span>
                            {inactive(rack.isActive)}
                            <span className="ml-auto">
                              <MenuButton
                                label={`rack ${rack.locationCode}`}
                                onClick={() =>
                                  setMenu({
                                    kind: 'rack',
                                    id: rack.id,
                                    label: `rack ${rack.locationCode}`,
                                    code: rack.code,
                                    isActive: rack.isActive,
                                    racks: 1,
                                    edit: { type: 'rack', zone, container, rack },
                                  })
                                }
                              />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {menu && (
        <NodeMenu
          target={menu}
          onClose={() => setMenu(null)}
          onForm={(next) => {
            setMenu(null);
            setForm(next);
          }}
        />
      )}
      <ResponsiveDialog
        open={!!form}
        onOpenChange={(open) => !open && setForm(null)}
        title={form ? FORM_TITLE[form.type] : ''}
      >
        {form && <NodeForm form={form} warehouseId={warehouse.id} onDone={done} />}
      </ResponsiveDialog>
    </section>
  );
}
