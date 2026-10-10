import { screen, waitFor } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { sessionStore } from './sessionStore';

const health = () =>
  jsonResponse(200, {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    timestamp: '2026-10-01T18:00:00.000Z',
    database: 'ok',
  });

async function fill(
  app: ReturnType<typeof renderApp>,
  current: string,
  next: string,
  confirm: string,
) {
  await app.user.type(await screen.findByLabelText('Contraseña actual'), current);
  await app.user.type(screen.getByLabelText('Nueva contraseña'), next);
  await app.user.type(screen.getByLabelText('Confirmar nueva contraseña'), confirm);
  await app.user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

describe('ChangePasswordPage (T11)', () => {
  const start = (routes: Parameters<typeof mockFetch>[0] = {}) =>
    mockFetch({
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(200, makeSession({ mustChangePassword: true })),
      'GET /api/v1/health': health,
      ...routes,
    });

  it('confirmación distinta → "Las contraseñas no coinciden" sin llamar a la API', async () => {
    const fetchMock = start();
    const app = renderApp('/change-password');
    await fill(app, 'actual-123', 'nueva-clave-1', 'otra-clave-2');

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /api/v1/auth/change-password')).toHaveLength(0);
  });

  it('nueva igual a la actual → mensaje del esquema', async () => {
    start();
    const app = renderApp('/change-password');
    await fill(app, 'misma-clave-1', 'misma-clave-1', 'misma-clave-1');

    expect(
      await screen.findByText('La nueva contraseña debe ser distinta de la actual'),
    ).toBeInTheDocument();
  });

  it('AUTH_PASSWORD_INCORRECT → error en "Contraseña actual"', async () => {
    start({
      'POST /api/v1/auth/change-password': () =>
        apiError(400, 'AUTH_PASSWORD_INCORRECT', 'La contraseña actual es incorrecta.'),
    });
    const app = renderApp('/change-password');
    await fill(app, 'mala-clave', 'nueva-clave-1', 'nueva-clave-1');

    expect(await screen.findByText('La contraseña actual es incorrecta.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña actual')).toHaveAttribute('aria-invalid', 'true');
  });

  it('éxito → sesión sin mustChangePassword, toast y navegación al destino', async () => {
    const updated = makeSession({ mustChangePassword: false });
    const fetchMock = start({
      'POST /api/v1/auth/change-password': () => jsonResponse(200, updated),
    });
    const app = renderApp('/change-password?next=%2Fpos');
    await fill(app, 'actual-123', 'nueva-clave-1', 'nueva-clave-1');

    await waitFor(() => expect(app.location()).toBe('/pos'));
    expect(sessionStore.get()?.me.user.mustChangePassword).toBe(false);
    expect(await screen.findByText('Contraseña actualizada')).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, 'POST /api/v1/auth/change-password')[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      currentPassword: 'actual-123',
      newPassword: 'nueva-clave-1',
    });
  });
});
