import { screen, waitFor, within } from '@testing-library/react';
import { BRANCH_S1, BRANCH_S2, makeSession } from '@/test/fixtures';
import { callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  choose,
  chooseFirstBranch,
  makeRoles,
  makeUser,
  permsOf,
  ROLE_IDS,
  usersKey,
} from './testing';

const pageOf = (items: ReturnType<typeof makeUser>[]) => () =>
  jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });

const owner = makeUser({ roleCode: 'OWNER', username: 'owner', fullName: 'Eliu Castillo' });
const seller = makeUser({
  username: 'jperez',
  fullName: 'Juan Pérez',
  mustChangePassword: true,
});

function start(session = makeSession({ branches: [BRANCH_S1, BRANCH_S2] })) {
  chooseFirstBranch(session);
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, session),
    'GET /api/v1/roles': () => jsonResponse(200, makeRoles(session.me.permissions)),
    [usersKey()]: pageOf([owner, seller]),
    [usersKey({ q: 'juan' })]: pageOf([seller]),
    [usersKey({ status: 'all' })]: pageOf([owner, seller]),
    [usersKey({ roleId: ROLE_IDS.SELLER })]: pageOf([seller]),
    [usersKey({ branchId: BRANCH_S2.id })]: pageOf([]),
  });
}

describe('UsersListPage (T25)', () => {
  it('muestra los usuarios; el Propietario lleva su etiqueta', async () => {
    start();
    renderApp('/users');

    const table = await screen.findByRole('table', { name: 'Usuarios' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Eliu Castillo');
    expect(rows[1]).toHaveTextContent('Propietario');
    expect(rows[2]).toHaveTextContent('Juan Pérez');
    expect(rows[2]).toHaveTextContent('Debe cambiar contraseña');
  });

  it('la búsqueda consulta con q después del debounce', async () => {
    const fetchMock = start();
    const app = renderApp('/users');
    await screen.findByText('Juan Pérez');

    await app.user.type(screen.getByRole('searchbox', { name: 'Buscar usuarios' }), 'juan');

    await waitFor(() => expect(callsTo(fetchMock, usersKey({ q: 'juan' }))).toHaveLength(1));
    for (const partial of ['j', 'ju', 'jua']) {
      expect(callsTo(fetchMock, usersKey({ q: partial }))).toHaveLength(0);
    }
    await waitFor(() => expect(screen.queryByText('Eliu Castillo')).not.toBeInTheDocument());
  });

  it('los filtros cambian la consulta', async () => {
    const fetchMock = start();
    const app = renderApp('/users');
    await screen.findByText('Juan Pérez');

    await choose(app.user, 'Estado', 'Todos');
    await waitFor(() => expect(callsTo(fetchMock, usersKey({ status: 'all' }))).toHaveLength(1));
    await choose(app.user, 'Estado', 'Activos');

    await choose(app.user, 'Rol', 'Vendedor');
    await waitFor(() =>
      expect(callsTo(fetchMock, usersKey({ roleId: ROLE_IDS.SELLER }))).toHaveLength(1),
    );
    await choose(app.user, 'Rol', 'Todos los roles');

    await choose(app.user, 'Sucursal', 'S2 · Sucursal Norte');
    await waitFor(() =>
      expect(callsTo(fetchMock, usersKey({ branchId: BRANCH_S2.id }))).toHaveLength(1),
    );
    expect(await screen.findByText('No hay usuarios que coincidan.')).toBeInTheDocument();
  });

  it('"Nuevo usuario" solo aparece con users.manage', async () => {
    start();
    const app = renderApp('/users');
    await app.user.click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    expect(app.location()).toBe('/users/new');
  });

  it('sin users.manage no aparece "Nuevo usuario"', async () => {
    const readOnly = makeSession({ role: 'SELLER' });
    readOnly.me.permissions = [...permsOf('SELLER'), 'users.read'].sort();
    start(readOnly);
    renderApp('/users');

    await screen.findByText('Juan Pérez');
    expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument();
  });

  it('al tocar una fila abre el detalle', async () => {
    start();
    const app = renderApp('/users');
    await app.user.click(await screen.findByText('Juan Pérez'));
    expect(app.location()).toBe(`/users/${seller.id}`);
  });
});
