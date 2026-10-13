import 'react-data-grid/lib/styles.css';
import {
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportIssue,
  type ImportSummary,
  validateImportRows,
} from '@warehouse-manager/shared';
import { ArrowLeft, CheckCircle2, Copy, Download, FileUp, Plus } from 'lucide-react';
import { type ClipboardEvent, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  type Column,
  DataGrid,
  type DataGridHandle,
  type RenderEditCellProps,
  renderTextEditor,
} from 'react-data-grid';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/shared/api/errors';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { notify } from '@/shared/ui/notify';
import {
  downloadImportTemplate,
  productsApi,
  useInvalidateProducts,
  useProductCatalogs,
} from './api';
import {
  duplicateRow,
  emptyGridRow,
  type GridRow,
  gridRowFrom,
  issuesByCell,
  pasteTsv,
  rowNumberOf,
  toImportRows,
} from './importGrid';

export const DESKTOP_ONLY_MESSAGE = 'Usa una computadora para la carga masiva';

const LIST_IDS: Partial<Record<ImportColumn, string>> = {
  categoría: 'import-categories',
  marca: 'import-brands',
};

const WIDTHS: Partial<Record<ImportColumn, number>> = { nombre: 220, categoría: 180 };

/** Editor de texto con autocompletado (`<datalist>`) para categoría y marca. */
function listEditor(listId: string) {
  return function ListEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
    const key = column.key as ImportColumn;
    return (
      <input
        autoFocus
        aria-label={`Editar ${key}`}
        list={listId}
        className="size-full px-2 outline-none"
        value={row[key]}
        onChange={(event) => onRowChange({ ...row, [key]: event.target.value })}
        onBlur={() => onClose(true)}
      />
    );
  };
}

interface ServerResult {
  issues: ImportIssue[];
  summary: ImportSummary;
}

function SummaryView({ summary }: { summary: ImportSummary }) {
  const { stock } = summary;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      <li>
        Productos: {summary.productsToCreate} nuevos, {summary.productsToUpdate} actualizados ·
        Variantes: {summary.variantsToCreate} nuevas, {summary.variantsToUpdate} actualizadas
      </li>
      {(summary.categoriesToCreate.length > 0 || summary.brandsToCreate.length > 0) && (
        <li>
          Se crearán:{' '}
          {[
            ...summary.categoriesToCreate.map((c) => `categoría "${c}"`),
            ...summary.brandsToCreate.map((b) => `marca "${b}"`),
          ].join(', ')}
        </li>
      )}
      <li>
        Existencia: {stock.units} unidades en {stock.rows} filas ({stock.unitsToStaging} a staging)
      </li>
    </ul>
  );
}

/** `/products/import`: editor tipo Excel, validación en vivo y en el servidor, aplicar todo o nada. */
export function BulkImportPage() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Carga masiva</h1>
        <p className="text-muted-foreground">{DESKTOP_ONLY_MESSAGE}.</p>
      </section>
    );
  }
  return <BulkImportEditor />;
}

function BulkImportEditor() {
  const { can } = useAuth();
  const invalidate = useInvalidateProducts();
  const catalogs = useProductCatalogs();
  const fileInput = useRef<HTMLInputElement>(null);
  const grid = useRef<DataGridHandle>(null);
  const [rows, setRows] = useState<GridRow[]>(() => [emptyGridRow()]);
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState<{ rowIdx: number; column: ImportColumn } | null>(null);
  const [server, setServer] = useState<(ServerResult & { version: number }) | null>(null);
  const [confirmStock, setConfirmStock] = useState(false);
  const [allowOverride, setAllowOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<ImportSummary | null>(null);
  const canOverride = can('inventory.override_capacity');

  const importRows = useMemo(() => toImportRows(rows), [rows]);
  const liveIssues = useMemo(() => validateImportRows(importRows), [importRows]);
  const liveCells = useMemo(() => issuesByCell(liveIssues), [liveIssues]);
  const serverCurrent = server?.version === version ? server : null;
  const serverCells = useMemo(() => issuesByCell(serverCurrent?.issues ?? []), [serverCurrent]);

  const edit = (next: GridRow[]) => {
    setRows(next);
    setVersion((v) => v + 1);
    setApplied(null);
  };

  const columns = useMemo<Column<GridRow>[]>(
    () => [
      {
        key: '#',
        name: '#',
        width: 48,
        frozen: true,
        renderCell: ({ rowIdx }) => (
          <span className="text-muted-foreground">{rowNumberOf(rowIdx)}</span>
        ),
      },
      ...IMPORT_COLUMNS.map((column): Column<GridRow> => ({
        key: column,
        name: column,
        width: WIDTHS[column] ?? 120,
        editable: true,
        renderEditCell: LIST_IDS[column] ? listEditor(LIST_IDS[column]) : renderTextEditor,
        renderCell: ({ row, rowIdx }) => {
          const key = `${rowNumberOf(rowIdx)}:${column}`;
          const message = liveCells.get(key) ?? serverCells.get(key);
          return (
            <span
              title={message}
              aria-invalid={message ? true : undefined}
              data-issue={message ? (liveCells.has(key) ? 'live' : 'server') : undefined}
              className={cn('block size-full', message && 'bg-destructive/15 text-destructive')}
            >
              {row[column]}
              {message && ' ⚠'}
            </span>
          );
        },
      })),
    ],
    [liveCells, serverCells],
  );

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!active || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    edit(pasteTsv(rows, active, text));
  };

  /**
   * Copia la fila de la celda activa (o la última) debajo de ella y activa la misma columna en
   * la copia. `flushSync` deja la fila nueva en el grid antes de moverle la selección.
   */
  const duplicate = () => {
    const current = active && active.rowIdx < rows.length ? active : null;
    const index = current ? current.rowIdx : rows.length - 1;
    const idx = current ? IMPORT_COLUMNS.indexOf(current.column) + 1 : 1;
    flushSync(() => edit(duplicateRow(rows, index)));
    grid.current?.setActivePosition({ idx, rowIdx: index + 1 }, { shouldFocus: true });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await productsApi.parseImport(file);
      edit(
        parsed.rows.length > 0 ? parsed.rows.map((r) => gridRowFrom(r.cells)) : [emptyGridRow()],
      );
      notify.success(`${parsed.rows.length} filas importadas`);
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    try {
      const result = await productsApi.validateImport({
        rows: importRows,
        allowCapacityOverride: allowOverride,
      });
      setServer({ ...result, version });
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const summary = await productsApi.commitImport({
        rows: importRows,
        allowCapacityOverride: allowOverride,
        confirmStockAddition: confirmStock,
      });
      setApplied(summary);
      setServer(null);
      notify.success('Carga aplicada');
      await invalidate();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'IMPORT_INVALID') {
        setServer((current) => current && { ...current, issues: error.details as ImportIssue[] });
      } else if (error instanceof ApiError && error.code === 'IMPORT_CONFIRMATION_REQUIRED') {
        setServer((current) => current && { ...current, summary: error.details as ImportSummary });
      }
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const adding = serverCurrent?.summary.stock.addingToExisting;
  const canApply =
    !!serverCurrent &&
    serverCurrent.issues.length === 0 &&
    liveIssues.length === 0 &&
    importRows.length > 0 &&
    (!adding?.units || confirmStock);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          to="/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Productos
        </Link>
        <h1 className="text-xl font-semibold">Carga masiva</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void downloadImportTemplate().catch(notify.error)}>
          <Download />
          Descargar plantilla
        </Button>
        <input
          ref={fileInput}
          type="file"
          aria-label="Archivo .xlsx"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
          <FileUp />
          Importar .xlsx
        </Button>
        <Button variant="outline" onClick={() => edit([...rows, emptyGridRow()])}>
          <Plus />
          Fila
        </Button>
        <Button variant="outline" onClick={duplicate}>
          <Copy />
          Duplicar fila
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            disabled={busy || importRows.length === 0}
            onClick={() => void validate()}
          >
            Validar en servidor
          </Button>
          <Button disabled={busy || !canApply} onClick={() => void apply()}>
            Aplicar
          </Button>
        </div>
      </div>

      <div onPaste={onPaste}>
        <DataGrid
          ref={grid}
          aria-label="Carga masiva"
          className="rdg-light h-[60vh]"
          columns={columns}
          rows={rows}
          rowKeyGetter={(row) => row.id}
          onRowsChange={edit}
          onActivePositionChange={({ rowIdx, column }) =>
            setActive(
              column && column.key !== '#' ? { rowIdx, column: column.key as ImportColumn } : null,
            )
          }
          enableVirtualization={rows.length > 100}
        />
      </div>
      <datalist id="import-categories">
        {catalogs.data?.categories.map((c) => (
          <option key={c.id} value={c.path} />
        ))}
      </datalist>
      <datalist id="import-brands">
        {catalogs.data?.brands.map((b) => (
          <option key={b.id} value={b.name} />
        ))}
      </datalist>

      <p className="text-sm text-muted-foreground">
        {liveIssues.length} errores en vivo · {serverCurrent ? serverCurrent.issues.length : 0}{' '}
        errores del servidor
      </p>
      {[...liveIssues, ...(serverCurrent?.issues ?? [])].length > 0 && (
        <ul aria-label="Errores" className="max-h-48 overflow-y-auto text-sm text-destructive">
          {[...liveIssues, ...(serverCurrent?.issues ?? [])].map((issue, i) => (
            <li key={i}>
              Fila {issue.rowNumber}
              {issue.field ? ` · ${issue.field}` : ''}: {issue.message}
            </li>
          ))}
        </ul>
      )}

      {serverCurrent && serverCurrent.issues.length === 0 && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <h2 className="font-medium">Resumen</h2>
          <SummaryView summary={serverCurrent.summary} />
          {!!adding?.units && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox
                checked={confirmStock}
                onCheckedChange={(v) => setConfirmStock(v === true)}
              />
              Confirmo sumar {adding.units} unidades a {adding.variants} variantes que ya tienen
              stock
            </label>
          )}
        </div>
      )}
      {canOverride && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox
            checked={allowOverride}
            onCheckedChange={(v) => {
              setAllowOverride(v === true);
              setVersion((current) => current + 1);
            }}
          />
          Permitir exceder capacidad
        </label>
      )}

      {applied && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-green-600/40 p-3"
        >
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 aria-hidden className="size-4 text-green-600" />
            Carga aplicada
          </p>
          <SummaryView summary={applied} />
        </div>
      )}
    </section>
  );
}
