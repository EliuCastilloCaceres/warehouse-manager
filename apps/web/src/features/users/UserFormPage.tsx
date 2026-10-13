import {
  type MeDto,
  type PermissionCode,
  type PermissionGroupDto,
  type RoleWithPermissionsDto,
  type UserDetailDto,
  UserCreateInput,
  type UserUpdateInput,
} from '@warehouse-manager/shared';
import { ArrowLeft } from 'lucide-react';
import { type ChangeEvent, type ComponentProps, useEffect, useState } from 'react';
import { type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { spanishErrors } from '@/shared/forms/zodErrors';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { useInvalidateUsers, usePermissionGroups, useRoles, useUser, usersApi } from './api';
import { type Credentials, CredentialsDialog } from './CredentialsDialog';
import { FieldError } from './fields';
import { PermissionMatrix } from './PermissionMatrix';
import { SEARCH_DEBOUNCE_MS } from './useDebouncedValue';
import { UserActions } from './UserActions';
import { type UserAccess, userAccess } from './userAccess';

interface FormValues {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  roleId: string;
  branchIds: string[];
  defaultBranchId: string;
  extraPermissions: PermissionCode[];
  passwordMode: 'generate' | 'manual';
  password: string;
}

const FIELDS = [
  'fullName',
  'username',
  'email',
  'phone',
  'roleId',
  'branchIds',
  'defaultBranchId',
  'extraPermissions',
  'password',
] as const;
type Field = (typeof FIELDS)[number];

const DUPLICATE_USERNAME = 'Este usuario ya existe';
const ADMIN_BRANCHES_NOTE =
  'El Administrador accede a todas las sucursales activas; aquí se elige la predeterminada.';

const optional = (value: string) => (value.trim() === '' ? null : value.trim());
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/** Valores del formulario → `UserCreateInput` (sin validar). */
function toCreateInput(values: FormValues) {
  return {
    username: values.username,
    fullName: values.fullName,
    email: optional(values.email),
    phone: optional(values.phone),
    roleId: values.roleId,
    branchIds: values.branchIds,
    defaultBranchId: values.defaultBranchId,
    extraPermissions: values.extraPermissions,
    password:
      values.passwordMode === 'manual'
        ? { mode: 'manual' as const, value: values.password }
        : { mode: 'generate' as const },
  };
}

/**
 * Valida con el contrato de `shared` (`UserCreateInput`). Al editar, el usuario y la
 * contraseña no se envían, así que se validan con valores que siempre pasan.
 */
function makeResolver(existing: UserDetailDto | null): Resolver<FormValues> {
  return async (values) => {
    const errors: Record<string, { type: string; message: string }> = {};
    const add = (field: Field, message: string) => {
      errors[field] ??= { type: 'validate', message };
    };
    if (!values.roleId) add('roleId', 'Elige un rol');
    if (values.branchIds.length > 0 && !values.defaultBranchId) {
      add('defaultBranchId', 'Elige la sucursal predeterminada');
    }
    const input = toCreateInput(values);
    const result = UserCreateInput.safeParse(
      existing ? { ...input, username: existing.username, password: { mode: 'generate' } } : input,
      { error: spanishErrors },
    );
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? '') as Field;
        if (FIELDS.includes(field)) add(field, issue.message);
      }
    }
    return Object.keys(errors).length > 0
      ? { values: {}, errors: errors as FieldErrors<FormValues> }
      : { values, errors: {} };
  };
}

function initialValues(me: MeDto, user: UserDetailDto | null): FormValues {
  if (user) {
    return {
      fullName: user.fullName,
      username: user.username,
      email: user.email ?? '',
      phone: user.phone ?? '',
      roleId: user.roleId,
      branchIds: user.branches.map((branch) => branch.id),
      defaultBranchId: user.branches.find((branch) => branch.isDefault)?.id ?? '',
      extraPermissions: user.extraPermissions,
      passwordMode: 'generate',
      password: '',
    };
  }
  const only = me.branches.length === 1 ? me.branches[0]!.id : '';
  return {
    fullName: '',
    username: '',
    email: '',
    phone: '',
    roleId: '',
    branchIds: only ? [only] : [],
    defaultBranchId: only,
    extraPermissions: [],
    passwordMode: 'generate',
    password: '',
  };
}

/** Cambios para `PATCH`: solo lo que difiere y lo que quien edita puede cambiar. */
function toUpdateInput(
  values: FormValues,
  user: UserDetailDto,
  access: UserAccess,
  canGrant: boolean,
): UserUpdateInput {
  const patch: UserUpdateInput = {};
  const fullName = values.fullName.trim();
  if (fullName !== user.fullName) patch.fullName = fullName;
  if (optional(values.email) !== user.email) patch.email = optional(values.email);
  if (optional(values.phone) !== user.phone) patch.phone = optional(values.phone);
  if (access.accessReadOnly) return patch;
  if (values.roleId !== user.roleId) patch.roleId = values.roleId;
  const currentIds = user.branches.map((branch) => branch.id);
  const currentDefault = user.branches.find((branch) => branch.isDefault)?.id;
  if (!sameSet(values.branchIds, currentIds) || values.defaultBranchId !== currentDefault) {
    patch.branchIds = values.branchIds;
    patch.defaultBranchId = values.defaultBranchId;
  }
  if (canGrant && !sameSet(values.extraPermissions, user.extraPermissions)) {
    patch.extraPermissions = values.extraPermissions;
  }
  return patch;
}

/** `/users/new` y `/users/:id` (spec F4 §7). */
export function UserFormPage() {
  const { id } = useParams();
  const user = useUser(id);
  const roles = useRoles();
  const groups = usePermissionGroups();
  const queries = id ? [user, roles, groups] : [roles, groups];
  const failed = queries.find((query) => query.isError);

  if (failed) {
    return (
      <ErrorState message={errorMessage(failed.error)} onRetry={() => void failed.refetch()} />
    );
  }
  if (!roles.data || !groups.data || (id && !user.data)) return <LoadingState />;
  return (
    <UserForm
      key={user.data?.updatedAt ?? 'new'}
      user={user.data ?? null}
      roles={roles.data}
      groups={groups.data}
    />
  );
}

interface UserFormProps {
  user: UserDetailDto | null;
  roles: RoleWithPermissionsDto[];
  groups: PermissionGroupDto[];
}

function UserForm({ user, roles, groups }: UserFormProps) {
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateUsers();
  const access = userAccess(me!, user);
  const canGrant = can('users.permissions');
  const [credentials, setCredentials] = useState<(Credentials & { id: string }) | null>(null);
  const [suggested, setSuggested] = useState(false);
  const [usernameEdited, setUsernameEdited] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: makeResolver(user),
    defaultValues: initialValues(me!, user),
  });

  const [fullName, roleId, branchIds, defaultBranchId, extraPermissions, passwordMode] = useWatch({
    control,
    name: [
      'fullName',
      'roleId',
      'branchIds',
      'defaultBranchId',
      'extraPermissions',
      'passwordMode',
    ],
  });
  const role = roles.find((r) => r.id === roleId);

  // Alta: al escribir el nombre se sugiere el usuario, hasta que se edita a mano.
  useEffect(() => {
    const name = fullName.trim();
    if (user || usernameEdited || !name) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      usersApi.suggestUsername(name, controller.signal).then(
        ({ username }) => {
          if (!username) return;
          setValue('username', username);
          setSuggested(true);
        },
        () => {},
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fullName, user, usernameEdited, setValue]);

  // Sucursales: las del actor y, al editar, las que ya tiene el usuario (solo lectura si no son suyas).
  const actorBranchIds = new Set(me!.branches.map((branch) => branch.id));
  const branchOptions = [
    ...me!.branches,
    ...(user?.branches.filter((branch) => !actorBranchIds.has(branch.id)) ?? []),
  ];

  const toggleBranch = (branchId: string, checked: boolean) => {
    const next = checked ? [...branchIds, branchId] : branchIds.filter((b) => b !== branchId);
    setValue('branchIds', next, { shouldDirty: true });
    if (!checked && defaultBranchId === branchId) {
      setValue('defaultBranchId', '', { shouldDirty: true });
      void trigger('defaultBranchId');
    } else if (checked && !defaultBranchId && next.length === 1) {
      setValue('defaultBranchId', branchId, { shouldDirty: true });
    }
  };

  const handleServerError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      setError('username', { type: 'server', message: DUPLICATE_USERNAME });
      return;
    }
    if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
      const details = Array.isArray(error.details)
        ? (error.details as { path?: string; message?: string }[])
        : [];
      let applied = false;
      for (const detail of details) {
        const field = (detail.path?.split('.')[0] ?? '') as Field;
        if (FIELDS.includes(field) && detail.message) {
          setError(field, { type: 'server', message: detail.message });
          applied = true;
        }
      }
      if (applied) return;
    }
    notify.error(error);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (!user) {
        const created = await usersApi.create(UserCreateInput.parse(toCreateInput(values)));
        await invalidate();
        if (created.generatedPassword) {
          setCredentials({
            id: created.user.id,
            fullName: created.user.fullName,
            username: created.user.username,
            password: created.generatedPassword,
          });
        } else {
          notify.success('Usuario creado');
          navigate(`/users/${created.user.id}`, { replace: true });
        }
        return;
      }
      const patch = toUpdateInput(values, user, access, canGrant);
      if (Object.keys(patch).length === 0) {
        notify.info('No hay cambios');
        return;
      }
      await usersApi.update(user.id, patch);
      notify.success('Cambios guardados');
      await invalidate();
    } catch (error) {
      handleServerError(error);
    }
  });

  const text = (
    name: 'fullName' | 'username' | 'email' | 'phone',
    label: string,
    props: ComponentProps<'input'> = {},
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`user-${name}`}>{label}</Label>
      <Input
        id={`user-${name}`}
        aria-invalid={!!errors[name]}
        readOnly={access.readOnly}
        {...props}
        {...register(name)}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link to="/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Usuarios
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{user ? user.fullName : 'Nuevo usuario'}</h1>
          {access.isOwner && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
              Propietario
            </span>
          )}
          {user && !user.isActive && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Inactivo</span>
          )}
        </div>
        {access.note && (
          <p className="text-sm text-muted-foreground">
            {access.isSelf && !access.readOnly ? (
              <>
                Para cambiar tu contraseña usa{' '}
                <Link to="/change-password" className="underline">
                  Cambiar contraseña
                </Link>
                .
              </>
            ) : (
              access.note
            )}
          </p>
        )}
        {user && access.showActions && <UserActions user={user} />}
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">Datos</legend>
          {text('fullName', 'Nombre completo', { autoComplete: 'off' })}
          <div className="space-y-1">
            <Label htmlFor="user-username">
              Usuario
              {suggested && !user && (
                <span className="font-normal text-muted-foreground">(sugerido)</span>
              )}
            </Label>
            <Input
              id="user-username"
              autoCapitalize="none"
              autoComplete="off"
              aria-invalid={!!errors.username}
              readOnly={!!user || access.readOnly}
              {...register('username', {
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  setUsernameEdited(event.target.value !== '');
                  setSuggested(false);
                },
              })}
            />
            <FieldError message={errors.username?.message} />
          </div>
          {text('email', 'Correo', { type: 'email', autoComplete: 'off' })}
          {text('phone', 'Teléfono', { type: 'tel', autoComplete: 'off' })}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">Rol</legend>
          <Label htmlFor="user-role" className="sr-only">
            Rol
          </Label>
          <Select
            value={roleId}
            disabled={access.accessReadOnly}
            onValueChange={(value) =>
              setValue('roleId', value, { shouldDirty: true, shouldValidate: true })
            }
          >
            <SelectTrigger id="user-role" className="w-full" aria-invalid={!!errors.roleId}>
              <SelectValue placeholder="Elige un rol" />
            </SelectTrigger>
            <SelectContent>
              {roles
                .filter((r) => r.code !== 'OWNER' || r.id === user?.roleId)
                .map((r) => (
                  <SelectItem
                    key={r.id}
                    value={r.id}
                    disabled={!r.assignable && r.id !== user?.roleId}
                  >
                    {r.assignable ? r.name : `${r.name} (Requiere permisos que no tienes)`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.roleId?.message} />
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 font-medium">Sucursales</legend>
          {role?.code === 'ADMIN' && (
            <p className="mb-1 text-sm text-muted-foreground">{ADMIN_BRANCHES_NOTE}</p>
          )}
          <RadioGroup
            aria-label="Sucursal predeterminada"
            value={defaultBranchId}
            onValueChange={(value) => {
              setValue('defaultBranchId', value, { shouldDirty: true });
              void trigger('defaultBranchId');
            }}
            className="gap-0"
          >
            {branchOptions.map((branch) => {
              const checked = branchIds.includes(branch.id);
              const locked = access.accessReadOnly || !actorBranchIds.has(branch.id);
              return (
                <div
                  key={branch.id}
                  className="flex min-h-11 flex-wrap items-center gap-x-6 gap-y-1"
                >
                  <label className="flex items-center gap-3">
                    <Checkbox
                      checked={checked}
                      disabled={locked}
                      onCheckedChange={(next) => toggleBranch(branch.id, next === true)}
                    />
                    {branch.code} · {branch.name}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem
                      value={branch.id}
                      aria-label={`Predeterminada: ${branch.code}`}
                      disabled={locked || !checked}
                    />
                    Predeterminada
                  </label>
                </div>
              );
            })}
          </RadioGroup>
          <FieldError message={errors.branchIds?.message ?? errors.defaultBranchId?.message} />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">Permisos</legend>
          {!canGrant && !access.accessReadOnly && (
            <p className="text-sm text-muted-foreground">
              Para agregar permisos extra necesitas «Asignar permisos a usuarios».
            </p>
          )}
          <PermissionMatrix
            groups={groups}
            rolePermissions={role?.permissions ?? []}
            value={extraPermissions}
            onChange={(next) => setValue('extraPermissions', next, { shouldDirty: true })}
            actorPermissions={me!.permissions}
            readOnly={access.accessReadOnly || !canGrant}
          />
        </fieldset>

        {!user && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">Contraseña</legend>
            <RadioGroup
              aria-label="Modo de contraseña"
              value={passwordMode}
              onValueChange={(value) =>
                setValue('passwordMode', value as FormValues['passwordMode'], { shouldDirty: true })
              }
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
            {passwordMode === 'manual' && (
              <div className="space-y-1">
                <Label htmlFor="user-password">Contraseña</Label>
                <Input
                  id="user-password"
                  type="text"
                  autoComplete="off"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <FieldError message={errors.password?.message} />
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              En los dos casos se pedirá cambiarla al iniciar sesión.
            </p>
          </fieldset>
        )}

        {!access.readOnly && (
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {user ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        )}
      </form>

      <CredentialsDialog
        credentials={credentials}
        onClose={() => navigate(`/users/${credentials!.id}`, { replace: true })}
      />
    </section>
  );
}
