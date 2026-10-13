import type { UserListItemDto } from '@warehouse-manager/shared';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { Can } from '@/features/auth/guards';
import { DEFAULT_TIME_ZONE, formatDateTime } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { DataTable, type DataTableColumn } from '@/shared/ui/DataTable';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import {
  type UserFilters,
  type UserStatusFilter,
  USERS_PAGE_SIZE,
  useRoles,
  useUsers,
} from './api';
import { useDebouncedValue } from './useDebouncedValue';

const columns: DataTableColumn<UserListItemDto>[] = [
  { key: 'fullName', header: 'Nombre', cell: (user) => user.fullName },
  { key: 'username', header: 'Usuario', cell: (user) => user.username },
  { key: 'role', header: 'Rol', cell: (user) => user.role.name },
  {
    key: 'branches',
    header: 'Sucursales',
    cell: (user) => user.branches.map((branch) => branch.code).join(', ') || '—',
  },
  {
    key: 'status',
    header: 'Estado',
    cell: (user) => (
      <div className="flex flex-col">
        <span className={user.isActive ? undefined : 'text-muted-foreground'}>
          {user.isActive ? '● Activo' : '○ Inactivo'}
        </span>
        {user.mustChangePassword && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            ⚠ Debe cambiar contraseña
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'lastLoginAt',
    header: 'Último acceso',
    cell: (user) =>
      user.lastLoginAt ? formatDateTime(user.lastLoginAt, DEFAULT_TIME_ZONE) : 'Nunca',
  },
];

/** Valor de "sin filtro": Radix Select no admite opciones con valor vacío. */
const ALL = 'all';

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [value: string, label: string])[];
}

function FilterSelect({ id, label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** `/users`: búsqueda, filtros (por defecto, solo activos) y paginación (spec F4 §7). */
export function UsersListPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const roles = useRoles();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Omit<UserFilters, 'q'>>({
    status: 'active',
    roleId: '',
    branchId: '',
    page: 1,
  });
  const q = useDebouncedValue(search);
  const users = useUsers({ ...filters, q });
  const totalPages = Math.max(1, Math.ceil((users.data?.total ?? 0) / USERS_PAGE_SIZE));

  const setFilter = (patch: Partial<Omit<UserFilters, 'q' | 'page'>>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  const setPage = (page: number) => setFilters((current) => ({ ...current, page }));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <Can perm="users.manage">
          <Button onClick={() => navigate('/users/new')}>
            <Plus />
            Nuevo usuario
          </Button>
        </Can>
      </div>

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Buscar usuarios"
          placeholder="Buscar nombre, usuario o correo"
          className="pl-9"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FilterSelect
          id="filter-status"
          label="Estado"
          value={filters.status}
          onChange={(status) => setFilter({ status: status as UserStatusFilter })}
          options={[
            ['active', 'Activos'],
            ['inactive', 'Inactivos'],
            ['all', 'Todos'],
          ]}
        />
        <FilterSelect
          id="filter-role"
          label="Rol"
          value={filters.roleId || ALL}
          onChange={(roleId) => setFilter({ roleId: roleId === ALL ? '' : roleId })}
          options={[
            [ALL, 'Todos los roles'],
            ...(roles.data ?? []).map((role) => [role.id, role.name] as const),
          ]}
        />
        <FilterSelect
          id="filter-branch"
          label="Sucursal"
          value={filters.branchId || ALL}
          onChange={(branchId) => setFilter({ branchId: branchId === ALL ? '' : branchId })}
          options={[
            [ALL, 'Todas las sucursales'],
            ...(me?.branches ?? []).map(
              (branch) => [branch.id, `${branch.code} · ${branch.name}`] as const,
            ),
          ]}
        />
      </div>

      <DataTable
        label="Usuarios"
        columns={columns}
        rows={users.data?.items}
        rowKey={(user) => user.id}
        loading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        emptyMessage="No hay usuarios que coincidan."
        onRowClick={(user) => navigate(`/users/${user.id}`)}
      />

      {users.data && users.data.total > USERS_PAGE_SIZE && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={filters.page <= 1}
            onClick={() => setPage(filters.page - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {filters.page} de {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={filters.page >= totalPages}
            onClick={() => setPage(filters.page + 1)}
          >
            Siguiente
          </Button>
        </nav>
      )}
    </section>
  );
}
