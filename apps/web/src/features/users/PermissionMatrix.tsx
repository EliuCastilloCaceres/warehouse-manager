import type { PermissionCode, PermissionGroupDto } from '@warehouse-manager/shared';
import { Checkbox } from '@/shared/ui/checkbox';
import { PERMISSION_MODULE_LABELS } from './moduleLabels';

export interface PermissionMatrixProps {
  groups: readonly PermissionGroupDto[];
  /** Permisos del rol elegido: marcados y bloqueados. */
  rolePermissions: readonly PermissionCode[];
  /** Permisos extra elegidos. */
  value: readonly PermissionCode[];
  onChange: (extras: PermissionCode[]) => void;
  /** Permisos de quien edita: no puede otorgar los que no tiene. */
  actorPermissions: readonly PermissionCode[];
  /** Sin `users.permissions`, o usuario de solo lectura. */
  readOnly: boolean;
}

/** Permisos por módulo: los del rol fijos ("Del rol") y los extras como casillas (spec F4 §7). */
export function PermissionMatrix({
  groups,
  rolePermissions,
  value,
  onChange,
  actorPermissions,
  readOnly,
}: PermissionMatrixProps) {
  const toggle = (code: PermissionCode, checked: boolean) =>
    onChange(checked ? [...value, code].sort() : value.filter((c) => c !== code));

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <fieldset key={group.module} className="rounded-md border p-3">
          <legend className="px-1 font-medium">{PERMISSION_MODULE_LABELS[group.module]}</legend>
          <ul className="flex flex-col">
            {group.permissions.map(({ code, description }) => {
              const fromRole = rolePermissions.includes(code);
              const actorLacks = !actorPermissions.includes(code);
              const id = `perm-${code}`;
              return (
                <li key={code}>
                  <label htmlFor={id} className="flex min-h-11 items-center gap-3 py-1">
                    <Checkbox
                      id={id}
                      checked={fromRole || value.includes(code)}
                      disabled={readOnly || fromRole || actorLacks}
                      onCheckedChange={(checked) => toggle(code, checked === true)}
                    />
                    <span className="flex-1">{description}</span>
                    {fromRole ? (
                      <span className="text-xs text-muted-foreground">Del rol</span>
                    ) : (
                      actorLacks && (
                        <span className="text-xs text-muted-foreground">No lo tienes</span>
                      )
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
