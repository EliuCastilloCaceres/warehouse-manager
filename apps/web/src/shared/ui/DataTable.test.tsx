import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setScreenWidth } from '@/test/media';
import { ApiError } from '@/shared/api/errors';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  sku: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'sku', header: 'SKU', cell: (row) => row.sku },
  { key: 'name', header: 'Nombre', cell: (row) => row.name },
];
const rows: Row[] = [
  { sku: 'ZAP0101-25-NEG', name: 'Zapato Oxford' },
  { sku: 'BOL0201-UN-CAF', name: 'Bolso tote' },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.sku}
      label="Productos"
      {...props}
    />,
  );
}

describe('DataTable (T21)', () => {
  it('desde 768 px muestra una <table> con encabezados', () => {
    setScreenWidth(1024);
    renderTable();

    const table = screen.getByRole('table', { name: 'Productos' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['SKU', 'Nombre']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('por debajo de 768 px muestra una lista de tarjetas', () => {
    setScreenWidth(375);
    renderTable();

    const list = screen.getByRole('list', { name: 'Productos' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('SKU')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Zapato Oxford')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('cambia de vista al cambiar el ancho de la ventana', () => {
    setScreenWidth(1024);
    renderTable();
    expect(screen.getByRole('table')).toBeInTheDocument();

    act(() => setScreenWidth(375));
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it.each([
    ['cargando', { loading: true }, 'Cargando…'],
    ['sin filas', { rows: [] }, 'No hay resultados.'],
    ['sin filas con mensaje propio', { rows: [], emptyMessage: 'Sin productos' }, 'Sin productos'],
  ])('%s → su estado', (_case, props, text) => {
    renderTable(props);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('con error muestra su mensaje y "Reintentar" llama a onRetry', async () => {
    const onRetry = jest.fn();
    renderTable({ error: new ApiError(500, 'INTERNAL_ERROR', 'Falló la carga'), onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Falló la carga');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['tabla', 1024, () => screen.getByText('Bolso tote')],
    ['tarjetas', 375, () => screen.getAllByRole('button')[1]],
  ])('onRowClick recibe la fila (%s)', async (_view, width, target) => {
    setScreenWidth(width);
    const onRowClick = jest.fn();
    renderTable({ onRowClick });

    await userEvent.click(target());
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});
