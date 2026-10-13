import type { UserDetailDto } from '@warehouse-manager/shared';
import { screen, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeRoles, makeUser, PERMISSION_GROUPS } from './testing';

function open(user: UserDetailDto, routes: Parameters<typeof mockFetch>[0] = {}) {
  const session = makeSession();
  const fetchMock = mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, session),
    'GET /api/v1/roles': () => jsonResponse(200, makeRoles(session.me.permissions)),
    'GET /api/v1/permissions': () => jsonResponse(200, PERMISSION_GROUPS),
    [`GET /api/v1/users/${user.id}`]: () => jsonResponse(200, user),
    ...routes,
  });
  return { ...renderApp(`/users/${user.id}`), fetchMock };
}

const confirmIn = async (app: ReturnType<typeof open>, label: string) => {
  const dialog = await screen.findByRole('dialog');
  await app.user.click(within(dialog).getByRole('button', { name: label }));
};

describe('UserActions (T32)', () => {
  it('"Desactivar" pide confirmación, llama a la API y muestra un toast', async () => {
    const user = makeUser({ fullName: 'Juan Pérez' });
    const app = open(user, {
      [`POST /api/v1/users/${user.id}/deactivate`]: () =>
        jsonResponse(200, { ...user, isActive: false }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Desactivar' }));
    expect(
      await screen.findByRole('dialog', { name: '¿Desactivar a Juan Pérez?' }),
    ).toHaveTextContent('Se cerrarán sus sesiones.');
    expect(callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/deactivate`)).toHaveLength(0);
    await confirmIn(app, 'Desactivar');

    expect(await screen.findByText('Usuario desactivado')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/deactivate`)).toHaveLength(1);
  });

  it('"Reactivar" igual', async () => {
    const user = makeUser({ fullName: 'Ana Ruiz', isActive: false });
    const app = open(user, {
      [`POST /api/v1/users/${user.id}/reactivate`]: () =>
        jsonResponse(200, { ...user, isActive: true }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Reactivar' }));
    expect(
      await screen.findByRole('dialog', { name: '¿Reactivar a Ana Ruiz?' }),
    ).toBeInTheDocument();
    await confirmIn(app, 'Reactivar');

    expect(await screen.findByText('Usuario reactivado')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/reactivate`)).toHaveLength(1);
  });

  it('"Restablecer" en modo generar abre las credenciales', async () => {
    const user = makeUser({ fullName: 'Juan Pérez', username: 'jperez' });
    const app = open(user, {
      [`POST /api/v1/users/${user.id}/reset-password`]: () =>
        jsonResponse(200, { generatedPassword: 'k7mp-x3qa-9vtw' }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Restablecer contraseña' }));
    await confirmIn(app, 'Restablecer');

    const credentials = await screen.findByRole('dialog', { name: 'Credenciales de Juan Pérez' });
    expect(credentials).toHaveTextContent('jperez');
    expect(credentials).toHaveTextContent('k7mp-x3qa-9vtw');
    const [, init] = callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/reset-password`)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ mode: 'generate' });
  });

  it('"Restablecer" en modo escribir valida y muestra un toast sin contraseña', async () => {
    const user = makeUser({ fullName: 'Juan Pérez' });
    const app = open(user, {
      [`POST /api/v1/users/${user.id}/reset-password`]: () =>
        jsonResponse(200, { generatedPassword: null }),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Restablecer contraseña' }));
    const dialog = await screen.findByRole('dialog');
    await app.user.click(within(dialog).getByLabelText('Escribirla'));
    await app.user.type(within(dialog).getByLabelText('Contraseña nueva'), 'corta');
    await app.user.click(within(dialog).getByRole('button', { name: 'Restablecer' }));
    expect(
      within(dialog).getByText('La contraseña debe tener al menos 8 caracteres'),
    ).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/reset-password`)).toHaveLength(0);

    await app.user.type(within(dialog).getByLabelText('Contraseña nueva'), '-clave-1');
    await app.user.click(within(dialog).getByRole('button', { name: 'Restablecer' }));

    expect(
      await screen.findByText('Contraseña restablecida. Se pedirá cambiarla al iniciar sesión.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('corta-clave-1')).not.toBeInTheDocument();
    const [, init] = callsTo(app.fetchMock, `POST /api/v1/users/${user.id}/reset-password`)[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      mode: 'manual',
      value: 'corta-clave-1',
    });
  });
});

describe('UserActions: errores (T33)', () => {
  it.each([
    ['USER_OUT_OF_SCOPE', 'No puedes modificar a un usuario con permisos que tú no tienes.'],
    ['PERMISSION_ESCALATION', 'No puedes otorgar permisos que no tienes.'],
    ['USER_OWNER_PROTECTED', 'El Propietario solo puede ser modificado por él mismo.'],
  ])('un 403 %s muestra el mensaje de la API y no cambia la vista', async (code, message) => {
    const user = makeUser({ fullName: 'Juan Pérez' });
    const app = open(user, {
      [`POST /api/v1/users/${user.id}/deactivate`]: () => apiError(403, code, message),
    });

    await app.user.click(await screen.findByRole('button', { name: 'Desactivar' }));
    await confirmIn(app, 'Desactivar');

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Juan Pérez' })).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `GET /api/v1/users/${user.id}`)).toHaveLength(1);
  });
});
