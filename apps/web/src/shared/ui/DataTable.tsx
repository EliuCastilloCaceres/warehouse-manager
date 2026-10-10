import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/shared/api/errors';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { EmptyState, ErrorState, LoadingState } from './states';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  /** Nombre accesible de la tabla o de la lista. */
  label: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

/** Tabla desde `md`; lista de tarjetas por debajo. Incluye los estados de carga, vacío y error. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  loading,
  error,
  onRetry,
  emptyMessage = 'No hay resultados.',
  onRowClick,
}: DataTableProps<T>) {
  const isDesktop = useIsDesktop();

  if (error) return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
  if (loading || !rows) return <LoadingState />;
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  if (isDesktop) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table aria-label={label} className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn('px-3 py-2 font-medium', column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn('border-t', onRowClick && 'cursor-pointer hover:bg-muted/50')}
                onClick={onRowClick && (() => onRowClick(row))}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {rows.map((row) => {
        const fields = (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {columns.map((column) => (
              <div key={column.key} className="contents">
                <dt className="text-muted-foreground">{column.header}</dt>
                <dd className="min-w-0 break-words">{column.cell(row)}</dd>
              </div>
            ))}
          </dl>
        );
        return (
          <li key={rowKey(row)} className="rounded-md border">
            {onRowClick ? (
              <button
                type="button"
                className="block min-h-11 w-full p-3 text-left hover:bg-muted/50"
                onClick={() => onRowClick(row)}
              >
                {fields}
              </button>
            ) : (
              <div className="p-3">{fields}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
