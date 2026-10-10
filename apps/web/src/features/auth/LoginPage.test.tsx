import { screen, waitFor } from '@testing-library/react';
import { BRANCH_S1, BRANCH_S2, makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';

const anonymous = () => apiError(401, 'AUTH_REFRESH_INVALID');
const health = () =>
  jsonResponse(200, {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    timestamp: '2026-10-01T18:00:00.000Z',
    database: 'ok',
  });

async function fillAndSubmit(
  app: ReturnType<typeof renderApp>,
  username: string,
  password: string,
) {
  if (username) await app.user.type(await screen.findByLabelText('Usuario'), username);
  if (password) await app.user.type(screen.getByLabelText('Contraseña'), password);
  await app.user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('LoginPage (T9)', () => {
  it('campos vacíos → mensajes de validación sin llamar a la API', async () => {
    const fetchMock = mockFetch({ 'POST /api/v1/auth/refresh': anonymous });
    const app = renderApp('/login');
    await screen.findByLabelText('Usuario');

    await app.user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findAllByText('Este campo es obligatorio')).toHaveLength(2);
    expect(callsTo(fetchMock, 'POST /api/v1/auth/login')).toHaveLength(0);
  });

  it('" Admin " se envía como "admin"', async () => {
    const fetchMock = mockFetch({
      'POST /api/v1/auth/refresh': anonymous,
      'POST /api/v1/auth/login': () => jsonResponse(200, makeSession()),
      'GET /api/v1/health': health,
    });
    const app = renderApp('/login');
    await fillAndSubmit(app, ' Admin ', 'clave-secreta');

    await waitFor(() => expect(callsTo(fetchMock, 'POST /api/v1/auth/login')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST /api/v1/auth/login')[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      username: 'admin',
      password: 'clave-secreta',
    });
  });

  it.each([
    [401, 'AUTH_INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos'],
    [429, 'RATE_LIMITED', 'Demasiados intentos; espera un momento e inténtalo de nuevo.'],
  ])('%i muestra el message de la API', async (status, code, message) => {
    mockFetch({
      'POST /api/v1/auth/refresh': anonymous,
      'POST /api/v1/auth/login': () => apiError(status, code, message),
    });
    const app = renderApp('/login');
    await fillAndSubmit(app, 'admin', 'mala');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('el botón se deshabilita mientras envía', async () => {
    let resolve: (r: Response) => void = () => {};
    mockFetch({
      'POST /api/v1/auth/refresh': anonymous,
      'POST /api/v1/auth/login': () => new Promise<Response>((r) => (resolve = r)),
    });
    const app = renderApp('/login');
    await fillAndSubmit(app, 'admin', 'clave');

    expect(await screen.findByRole('button', { name: 'Entrando…' })).toBeDisabled();
    resolve(apiError(401, 'AUTH_INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos'));
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });
});

describe('destino tras el login (T10)', () => {
  it.each([
    [
      'mustChangePassword',
      makeSession({ mustChangePassword: true }),
      '/login?next=%2Fpos',
      '/change-password',
    ],
    [
      'más de una sucursal sin elección guardada',
      makeSession({ branches: [BRANCH_S1, BRANCH_S2] }),
      '/login?next=%2Fpos',
      '/select-branch',
    ],
    ['una sucursal con next', makeSession({ branches: [BRANCH_S1] }), '/login?next=%2Fpos', '/pos'],
    ['una sucursal sin next', makeSession({ branches: [BRANCH_S1] }), '/login', '/'],
  ])('%s', async (_name, session, start, pathname) => {
    mockFetch({
      'POST /api/v1/auth/refresh': anonymous,
      'POST /api/v1/auth/login': () => jsonResponse(200, session),
      'GET /api/v1/health': health,
    });
    const app = renderApp(start);
    await fillAndSubmit(app, 'admin', 'clave-secreta');

    await waitFor(() => expect(app.router.state.location.pathname).toBe(pathname));
  });
});
