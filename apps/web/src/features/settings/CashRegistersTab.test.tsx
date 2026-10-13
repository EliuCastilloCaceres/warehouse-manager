import { screen, waitFor, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeRegister } from './testing';

const C1 = makeRegister('C1', 'Caja 1', 1);
const C2 = makeRegister('C2', 'Caja 2', 2);
const LIST = 'GET /api/v1/cash-registers';

function open(routes: Parameters<typeof mockFetch>[0] = {}) {
  const fetchMock = mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
    [LIST]: () => jsonResponse(200, [C1, C2]),
    ...routes,
  });
  return { ...renderApp('/settings/registers'), fetchMock };
}

describe('CashRegistersTab (T25)', () => {
  it('lista las cajas con la nota y sin botón para agregar', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Cajas' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['C1 · Caja 1Editar', 'C2 · Caja 2Editar']);
    expect(screen.getByText('No se pueden agregar ni eliminar cajas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /agregar|nueva/i })).not.toBeInTheDocument();
  });
});

describe('CashRegistersTab: edición (T26)', () => {
  it('"Editar" abre el diálogo; guardar envía los cambios y actualiza la lista', async () => {
    const app = open({
      [LIST]: [
        () => jsonResponse(200, [C1, C2]),
        () => jsonResponse(200, [{ ...C1, name: 'Caja principal' }, C2]),
      ],
      [`PATCH /api/v1/cash-registers/${C1.id}`]: () =>
        jsonResponse(200, { ...C1, name: 'Caja principal' }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Editar C1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar caja C1' });
    const name = within(dialog).getByLabelText('Nombre');
    await app.user.clear(name);
    await app.user.type(name, 'Caja principal');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Caja actualizada')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Cajas' })).getAllByRole('listitem')[0],
      ).toHaveTextContent('C1 · Caja principal'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [, init] = callsTo(app.fetchMock, `PATCH /api/v1/cash-registers/${C1.id}`)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Caja principal' });
  });

  it('un 409 muestra el error en "Código" sin cerrar el diálogo', async () => {
    const app = open({
      [`PATCH /api/v1/cash-registers/${C1.id}`]: () =>
        apiError(409, 'CONFLICT', 'Ya existe una caja con ese código.', { target: ['code'] }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Editar C1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar caja C1' });
    const code = within(dialog).getByLabelText('Código');
    await app.user.clear(code);
    await app.user.type(code, 'c2');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(dialog).findByText('Ya existe una caja con ese código'),
    ).toBeInTheDocument();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Editar caja C1' })).toBeInTheDocument();
    const [, init] = callsTo(app.fetchMock, `PATCH /api/v1/cash-registers/${C1.id}`)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ code: 'C2' });
  });
});

describe('CashRegistersTab: otros casos', () => {
  it('sin cajas muestra el aviso', async () => {
    open({ [LIST]: () => jsonResponse(200, []) });
    expect(await screen.findByText('Esta sucursal no tiene cajas.')).toBeInTheDocument();
  });

  it('si no se pueden cargar ofrece reintentar', async () => {
    const app = open({
      [LIST]: [
        () => apiError(500, 'INTERNAL_ERROR', 'Falló el servidor'),
        () => jsonResponse(200, [C1]),
      ],
    });
    expect(await screen.findByText('Falló el servidor')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Editar C1' })).toBeInTheDocument();
  });

  it('guardar sin cambios o Escape cierran el diálogo sin llamar a la API', async () => {
    const app = open();
    await app.user.click(await screen.findByRole('button', { name: 'Editar C1' }));
    await app.user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await app.user.click(screen.getByRole('button', { name: 'Editar C2' }));
    await screen.findByRole('dialog', { name: 'Editar caja C2' });
    await app.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(app.fetchMock, `PATCH /api/v1/cash-registers/${C1.id}`)).toHaveLength(0);
  });

  it('otro error se muestra en un aviso', async () => {
    const app = open({
      [`PATCH /api/v1/cash-registers/${C1.id}`]: () =>
        apiError(403, 'BRANCH_FORBIDDEN', 'No tienes acceso a esa sucursal.'),
    });
    await app.user.click(await screen.findByRole('button', { name: 'Editar C1' }));
    const dialog = await screen.findByRole('dialog');
    await app.user.type(within(dialog).getByLabelText('Nombre'), ' bis');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('No tienes acceso a esa sucursal.')).toBeInTheDocument();
  });
});
