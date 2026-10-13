import type { ProductListItemDto, ProductType } from '@warehouse-manager/shared';
import { FileSpreadsheet, ImageIcon, Plus, Search, Tags } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Can } from '@/features/auth/guards';
import { useDebouncedValue } from '@/features/users/useDebouncedValue';
import { ApiError } from '@/shared/api/errors';
import { ScanInput, type ValidScan } from '@/shared/scan/ScanInput';
import { Button } from '@/shared/ui/button';
import { DataTable, type DataTableColumn } from '@/shared/ui/DataTable';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import {
  type ProductFilters,
  PRODUCTS_PAGE_SIZE,
  type ProductStatusFilter,
  productsApi,
  useProductCatalogs,
  useProducts,
} from './api';

export const WRONG_CODE_MESSAGES = {
  location: 'Este código es de una ubicación, no de un producto',
  promo: 'Este código es de una promoción, no de un producto',
} as const;
export const PRODUCT_NOT_FOUND = 'No se encontró el producto';

/** Valor de "sin filtro": Radix Select no admite opciones con valor vacío. */
const ALL = 'all';

const columns: DataTableColumn<ProductListItemDto>[] = [
  {
    key: 'image',
    header: 'Imagen',
    cell: (product) =>
      product.thumbUrl ? (
        <img src={product.thumbUrl} alt="" className="size-12 rounded object-cover" />
      ) : (
        <span className="flex size-12 items-center justify-center rounded bg-muted">
          <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
        </span>
      ),
  },
  {
    key: 'sku',
    header: 'SKU',
    cell: (product) => <span className="font-mono">{product.sku}</span>,
  },
  { key: 'name', header: 'Nombre', cell: (product) => product.name },
  {
    key: 'stock',
    header: 'Existencia',
    cell: (product) =>
      `${product.variantCount} ${product.variantCount === 1 ? 'variante' : 'variantes'} · ${product.totalStock} pzas`,
  },
  {
    key: 'status',
    header: 'Estado',
    cell: (product) => (product.isActive ? 'Activo' : 'Inactivo'),
  },
];

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

/** `/products`: escaneo, búsqueda, filtros y lista (spec F6 §7). */
export function ProductsListPage() {
  const navigate = useNavigate();
  const catalogs = useProductCatalogs();
  const [search, setSearch] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<Omit<ProductFilters, 'q'>>({
    status: 'active',
    type: '',
    categoryId: '',
    page: 1,
  });
  const q = useDebouncedValue(search);
  const products = useProducts({ ...filters, q });
  const totalPages = Math.max(1, Math.ceil((products.data?.total ?? 0) / PRODUCTS_PAGE_SIZE));

  const setFilter = (patch: Partial<Omit<ProductFilters, 'q' | 'page'>>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  const setPage = (page: number) => setFilters((current) => ({ ...current, page }));

  const onScan = async (scan: ValidScan) => {
    if (scan.kind !== 'product') {
      setScanMessage(WRONG_CODE_MESSAGES[scan.kind]);
      return;
    }
    setScanMessage(null);
    try {
      const result = await productsApi.lookup(scan.code);
      navigate(`/products/${result.product.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND')
        setScanMessage(PRODUCT_NOT_FOUND);
      else notify.error(error);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Productos</h1>
        <div className="flex flex-wrap gap-2">
          <Can perm="products.import">
            <Button variant="outline" onClick={() => navigate('/products/import')}>
              <FileSpreadsheet />
              Carga masiva
            </Button>
          </Can>
          <Can perm="products.labels">
            <Button variant="outline" onClick={() => navigate('/products/labels')}>
              <Tags />
              Etiquetas
            </Button>
          </Can>
          <Can perm="products.manage">
            <Button onClick={() => navigate('/products/new')}>
              <Plus />
              Nuevo
            </Button>
          </Can>
        </div>
      </div>

      <ScanInput label="Escanear producto" onScan={(scan) => void onScan(scan)} />
      {scanMessage && (
        <p role="alert" className="text-sm text-destructive">
          {scanMessage}
        </p>
      )}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Buscar productos"
          placeholder="Buscar por SKU, nombre o marca"
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
          onChange={(status) => setFilter({ status: status as ProductStatusFilter })}
          options={[
            ['active', 'Activos'],
            ['inactive', 'Inactivos'],
            ['all', 'Todos'],
          ]}
        />
        <FilterSelect
          id="filter-type"
          label="Tipo"
          value={filters.type || ALL}
          onChange={(type) => setFilter({ type: type === ALL ? '' : (type as ProductType) })}
          options={[
            [ALL, 'Todos los tipos'],
            ['SIMPLE', 'Simple'],
            ['VARIABLE', 'Con variantes'],
          ]}
        />
        <FilterSelect
          id="filter-category"
          label="Categoría"
          value={filters.categoryId || ALL}
          onChange={(categoryId) => setFilter({ categoryId: categoryId === ALL ? '' : categoryId })}
          options={[
            [ALL, 'Todas las categorías'],
            ...(catalogs.data?.categories ?? []).map((c) => [c.id, c.path] as const),
          ]}
        />
      </div>

      <DataTable
        label="Productos"
        columns={columns}
        rows={products.data?.items}
        rowKey={(product) => product.id}
        loading={products.isPending}
        error={products.error}
        onRetry={() => void products.refetch()}
        emptyMessage="No hay productos que coincidan."
        onRowClick={(product) => navigate(`/products/${product.id}`)}
      />

      {products.data && products.data.total > PRODUCTS_PAGE_SIZE && (
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
