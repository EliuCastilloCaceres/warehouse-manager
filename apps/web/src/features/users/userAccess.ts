import { isWithinScope, type MeDto, type UserDetailDto } from '@warehouse-manager/shared';

export interface UserAccess {
  /** Ningún campo es editable. */
  readOnly: boolean;
  /** Rol, sucursales y permisos no son editables. */
  accessReadOnly: boolean;
  /** Restablecer, desactivar y reactivar. */
  showActions: boolean;
  isSelf: boolean;
  isOwner: boolean;
  /** Aviso del caso especial (spec F4 §7). */
  note: string | null;
}

/**
 * Qué puede hacer quien mira la ficha, con las mismas reglas que la API (spec F4 §3):
 * el Propietario solo se modifica a sí mismo, nadie cambia su propio acceso y nadie actúa
 * sobre usuarios con permisos que no tiene. La API sigue siendo la autoridad.
 */
export function userAccess(me: MeDto, user: UserDetailDto | null): UserAccess {
  const canManage = me.permissions.includes('users.manage');
  if (!user) {
    return {
      readOnly: !canManage,
      accessReadOnly: !canManage,
      showActions: false,
      isSelf: false,
      isOwner: false,
      note: null,
    };
  }
  const isSelf = me.user.id === user.id;
  const isOwner = user.role.code === 'OWNER';
  const outOfScope = !isSelf && !isWithinScope(me.permissions, user.effectivePermissions);
  const ownerByOther = isOwner && !isSelf;
  const readOnly = !canManage || ownerByOther || outOfScope;

  let note: string | null = null;
  if (ownerByOther) note = 'Solo el Propietario puede modificar su cuenta.';
  else if (outOfScope) note = 'Tiene permisos que tú no tienes.';
  else if (isSelf) note = 'Para cambiar tu contraseña usa Cambiar contraseña.';

  return {
    readOnly,
    accessReadOnly: readOnly || isSelf,
    showActions: !readOnly && !isSelf,
    isSelf,
    isOwner,
    note,
  };
}
