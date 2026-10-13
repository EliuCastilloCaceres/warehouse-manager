import { UserCreateInput, type AuthSessionDto } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { BRANCH_S1, BRANCH_S2, makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import {
  choose,
  chooseFirstBranch,
  makeRoles,
  makeUser,
  PERMISSION_GROUPS,
  permsOf,
  ROLE_IDS,
} from './testing';

const SUGGEST = `GET /api/v1/users/suggest-username?${new URLSearchParams({ fullName: 'Juan Pérez' })}`;

function start(session: AuthSessionDto, routes: Parameters<typeof mockFetch>[0] = {}) {
  if (session.me.branches.length > 1) chooseFirstBranch(session);
  return mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, session),
    'GET /api/v1/roles': () => jsonResponse(200, makeRoles(session.me.permissions)),
    'GET /api/v1/permissions': () => jsonResponse(200, PERMISSION_GROUPS),
    'GET /api/v1/users?page=1&pageSize=20&isActive=true': () =>
      jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }),
    ...routes,
  });
}

const roleSelect = () => screen.findByLabelText('Rol');
const usernameInput = () => screen.getByRole('textbox', { name: /^Usuario( |$)/ });

describe('UserFormPage: alta (T26)', () => {
  it('sugiere el usuario al escribir el nombre y se puede editar', async () => {
    start(makeSession(), { [SUGGEST]: () => jsonResponse(200, { username: 'jperez' }) });
    const app = renderApp('/users/new');

    await app.user.type(await screen.findByLabelText('Nombre completo'), 'Juan Pérez');
    const username = usernameInput();
    await waitFor(() => expect(username).toHaveValue('jperez'));
    expect(screen.getByText('(sugerido)')).toBeInTheDocument();

    await app.user.type(username, '2');
    expect(username).toHaveValue('jperez2');
    expect(screen.queryByText('(sugerido)')).not.toBeInTheDocument();
  });

  it('"Escribirla" muestra el campo de contraseña con su validación', async () => {
    const fetchMock = start(makeSession());
    const app = renderApp('/users/new');

    expect(await screen.findByLabelText('Nombre completo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    await app.user.click(screen.getByLabelText('Escribirla'));
    await app.user.type(screen.getByLabelText('Contraseña'), 'corta');
    await app.user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(
      await screen.findByText('La contraseña debe tener al menos 8 caracteres'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /api/v1/users')).toHaveLength(0);
  });

  it('al guardar envía un UserCreateInput válido y muestra las credenciales', async () => {
    const created = makeUser({ username: 'jperez', fullName: 'Juan Pérez' });
    const fetchMock = start(makeSession(), {
      [SUGGEST]: () => jsonResponse(200, { username: 'jperez' }),
      'POST /api/v1/users': () =>
        jsonResponse(201, { user: created, generatedPassword: 'k7mp-x3qa-9vtw' }),
      [`GET /api/v1/users/${created.id}`]: () => jsonResponse(200, created),
    });
    const app = renderApp('/users/new');

    await app.user.type(await screen.findByLabelText('Nombre completo'), 'Juan Pérez');
    await waitFor(() => expect(usernameInput()).toHaveValue('jperez'));
    await app.user.type(screen.getByLabelText('Correo'), 'juan@tienda.mx');
    await choose(app.user, 'Rol', 'Vendedor');
    await app.user.click(screen.getByRole('checkbox', { name: /^Aplicar descuentos/ }));
    await app.user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    const dialog = await screen.findByRole('dialog', { name: 'Credenciales de Juan Pérez' });
    expect(dialog).toHaveTextContent('k7mp-x3qa-9vtw');
    const [, init] = callsTo(fetchMock, 'POST /api/v1/users')[0]!;
    const body: unknown = JSON.parse((init as RequestInit).body as string);
    expect(UserCreateInput.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      username: 'jperez',
      fullName: 'Juan Pérez',
      email: 'juan@tienda.mx',
      phone: null,
      roleId: ROLE_IDS.SELLER,
      branchIds: [BRANCH_S1.id],
      defaultBranchId: BRANCH_S1.id,
      extraPermissions: ['pos.discount'],
      password: { mode: 'generate' },
    });

    await app.user.click(within(dialog).getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(app.location()).toBe(`/users/${created.id}`));
  });

  it('un 409 muestra "Este usuario ya existe" en el campo', async () => {
    start(makeSession(), {
      'POST /api/v1/users': () =>
        apiError(409, 'CONFLICT', 'Este usuario ya existe.', { target: ['username'] }),
    });
    const app = renderApp('/users/new');

    await app.user.type(await screen.findByLabelText('Nombre completo'), 'Ana');
    await app.user.type(usernameInput(), 'ana');
    await choose(app.user, 'Rol', 'Vendedor');
    await app.user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('Este usuario ya existe')).toBeInTheDocument();
    expect(usernameInput()).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('UserFormPage: rol (T29)', () => {
  it('no ofrece OWNER y deshabilita los roles no asignables', async () => {
    start(makeSession({ role: 'MANAGER' }));
    const app = renderApp('/users/new');

    await app.user.click(await roleSelect());
    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Administrador (Requiere permisos que no tienes)',
      'Gerente',
      'Vendedor',
      'Almacenista',
    ]);
    expect(options[0]).toHaveAttribute('aria-disabled', 'true');
    expect(options[1]).not.toHaveAttribute('aria-disabled');
  });

  it('con rol ADMIN se ve el aviso de sucursales', async () => {
    start(makeSession());
    const app = renderApp('/users/new');

    await choose(app.user, 'Rol', 'Administrador');
    expect(
      screen.getByText(
        'El Administrador accede a todas las sucursales activas; aquí se elige la predeterminada.',
      ),
    ).toBeInTheDocument();
  });
});

describe('UserFormPage: sucursales (T30)', () => {
  it('salen de me.branches y la predeterminada solo se elige entre las marcadas', async () => {
    start(makeSession({ branches: [BRANCH_S1, BRANCH_S2] }));
    const app = renderApp('/users/new');

    const s1 = await screen.findByRole('checkbox', { name: 'S1 · Sucursal Centro' });
    const s2 = screen.getByRole('checkbox', { name: 'S2 · Sucursal Norte' });
    const defaultS1 = screen.getByRole('radio', { name: 'Predeterminada: S1' });
    const defaultS2 = screen.getByRole('radio', { name: 'Predeterminada: S2' });
    expect(defaultS2).toBeDisabled();

    await app.user.click(s1);
    expect(defaultS1).toBeChecked();
    await app.user.click(s2);
    expect(defaultS2).toBeEnabled();
    await app.user.click(defaultS2);
    expect(defaultS2).toBeChecked();

    await app.user.click(s2);
    expect(defaultS2).not.toBeChecked();
    expect(defaultS1).not.toBeChecked();
    expect(await screen.findByText('Elige la sucursal predeterminada')).toBeInTheDocument();
  });
});

describe('UserFormPage: edición (T31)', () => {
  const editing = async (
    session: AuthSessionDto,
    user: ReturnType<typeof makeUser>,
    routes: Parameters<typeof mockFetch>[0] = {},
  ) => {
    const fetchMock = start(session, {
      [`GET /api/v1/users/${user.id}`]: () => jsonResponse(200, user),
      ...routes,
    });
    const app = renderApp(`/users/${user.id}`);
    await screen.findByRole('heading', { name: user.fullName });
    return { ...app, fetchMock };
  };

  it('"Usuario" es de solo lectura', async () => {
    await editing(makeSession(), makeUser({ fullName: 'Juan Pérez' }));
    expect(usernameInput()).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Nombre completo')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
  });

  it('el Propietario visto por otro es de solo lectura y sin acciones', async () => {
    await editing(makeSession(), makeUser({ roleCode: 'OWNER', fullName: 'Dueña' }));
    expect(screen.getByText('Propietario', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Rol')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Restablecer contraseña' }),
    ).not.toBeInTheDocument();
  });

  it('sobre uno mismo, rol, sucursales y permisos son de solo lectura y sin acciones', async () => {
    const session = makeSession();
    const self = makeUser({
      id: session.me.user.id,
      roleCode: 'ADMIN',
      fullName: 'Eliu Castillo',
    });
    await editing(session, self);

    expect(screen.getByLabelText('Rol')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'S1 · Sucursal Centro' })).toBeDisabled();
    for (const checkbox of within(screen.getByRole('group', { name: 'Permisos' })).getAllByRole(
      'checkbox',
    )) {
      expect(checkbox).toBeDisabled();
    }
    expect(screen.getByText(/Para cambiar tu contraseña usa/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Restablecer contraseña' }),
    ).not.toBeInTheDocument();
  });

  it('un usuario fuera de alcance se muestra de solo lectura con su nota', async () => {
    await editing(
      makeSession({ role: 'MANAGER' }),
      makeUser({ roleCode: 'ADMIN', fullName: 'Ana' }),
    );
    expect(screen.getByText('Tiene permisos que tú no tienes.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('guarda solo los campos que cambiaron', async () => {
    const user = makeUser({ fullName: 'Juan Pérez' });
    const app = await editing(makeSession(), user, {
      [`PATCH /api/v1/users/${user.id}`]: () =>
        jsonResponse(200, { ...user, phone: '555 111 2222', extraPermissions: ['pos.discount'] }),
    });

    await app.user.type(screen.getByLabelText('Teléfono'), '555 111 2222');
    await app.user.click(screen.getByRole('checkbox', { name: /^Aplicar descuentos/ }));
    await app.user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    const [, init] = callsTo(app.fetchMock, `PATCH /api/v1/users/${user.id}`)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      phone: '555 111 2222',
      extraPermissions: ['pos.discount'],
    });
  });

  it('sin cambios avisa y no llama a la API', async () => {
    const user = makeUser({ fullName: 'Sin Cambios' });
    const app = await editing(makeSession(), user);
    await app.user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No hay cambios')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `PATCH /api/v1/users/${user.id}`)).toHaveLength(0);
  });

  it('con users.manage pero sin users.permissions no edita extras', async () => {
    await editing(makeSession({ role: 'MANAGER' }), makeUser({ fullName: 'Vendedor' }));
    expect(
      screen.getByText('Para agregar permisos extra necesitas «Asignar permisos a usuarios».'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Aplicar descuentos/ })).toBeDisabled();
    expect(permsOf('MANAGER')).not.toContain('users.permissions');
  });
});
