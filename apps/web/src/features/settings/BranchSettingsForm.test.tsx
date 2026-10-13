import { screen, waitFor, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { setScreenWidth } from '@/test/media';
import { renderApp } from '@/test/renderApp';
import { MEXICO_TIME_ZONES } from './timeZones';
import { BRANCH_URL, makeBranch } from './testing';

function open(branch = makeBranch(), routes: Parameters<typeof mockFetch>[0] = {}) {
  const fetchMock = mockFetch({
    'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
    [`GET ${BRANCH_URL}`]: () => jsonResponse(200, branch),
    ...routes,
  });
  return { ...renderApp('/settings/branch'), fetchMock };
}

const patchBody = (fetchMock: jest.Mock) => {
  const [, init] = callsTo(fetchMock, `PATCH ${BRANCH_URL}`).at(-1)!;
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
};

const SALES_NOTICE = /^Aplica a ventas nuevas/;

describe('BranchSettingsForm (T17)', () => {
  it('carga la sucursal actual; "Código" es de solo lectura', async () => {
    open();
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Sucursal Centro');
    expect(screen.getByLabelText('Código')).toHaveValue('S1');
    expect(screen.getByLabelText('Código')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('RFC')).toHaveValue('CEJ010101AB1');
  });

  it('al guardar envía solo los campos modificados, avisa y recarga la sucursal', async () => {
    const app = open(makeBranch(), {
      [`PATCH ${BRANCH_URL}`]: () => jsonResponse(200, makeBranch({ name: 'Sucursal Norte' })),
    });
    const name = await screen.findByLabelText('Nombre');
    await app.user.clear(name);
    await app.user.type(name, 'Sucursal Norte');
    await app.user.clear(screen.getByLabelText('Teléfono'));
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Ajustes guardados')).toBeInTheDocument();
    expect(patchBody(app.fetchMock)).toEqual({ name: 'Sucursal Norte', phone: null });
    await waitFor(() => expect(callsTo(app.fetchMock, `GET ${BRANCH_URL}`)).toHaveLength(2));
  });

  it('un 400 con path taxId muestra el error en "RFC"', async () => {
    const app = open(makeBranch(), {
      [`PATCH ${BRANCH_URL}`]: () =>
        apiError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', [
          { path: 'taxId', message: 'RFC rechazado por el servidor' },
        ]),
    });
    const rfc = await screen.findByLabelText('RFC');
    await app.user.clear(rfc);
    await app.user.type(rfc, 'XAXX010101000');
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('RFC rechazado por el servidor')).toBeInTheDocument();
    expect(rfc).toHaveAttribute('aria-invalid', 'true');
  });

  it('un RFC inválido no llama a la API', async () => {
    const app = open();
    const rfc = await screen.findByLabelText('RFC');
    await app.user.clear(rfc);
    await app.user.type(rfc, 'ABC123');
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('RFC no válido')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `PATCH ${BRANCH_URL}`)).toHaveLength(0);
  });
});

describe('BranchSettingsForm: IVA y zona horaria (T18)', () => {
  it.each([
    ['16', 1600],
    ['16.5', 1650],
  ])('IVA %s → taxRateBp %i', async (percent, bp) => {
    const app = open(makeBranch({ taxRateBp: 800 }), {
      [`PATCH ${BRANCH_URL}`]: () => jsonResponse(200, makeBranch({ taxRateBp: bp })),
    });
    const tax = await screen.findByLabelText('IVA (%)');
    expect(tax).toHaveValue('8');
    await app.user.clear(tax);
    await app.user.type(tax, percent);
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(patchBody(app.fetchMock)).toEqual({ taxRateBp: bp }));
  });

  it('IVA 101 → error de validación sin llamar a la API', async () => {
    const app = open();
    const tax = await screen.findByLabelText('IVA (%)');
    await app.user.clear(tax);
    await app.user.type(tax, '101');
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('Escribe un porcentaje de 0 a 100, con hasta 2 decimales'),
    ).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `PATCH ${BRANCH_URL}`)).toHaveLength(0);
  });

  it('el aviso aparece solo al cambiar el IVA, "precios incluyen IVA" o la zona horaria', async () => {
    const app = open();
    await app.user.type(await screen.findByLabelText('Nombre'), ' 2');
    expect(screen.queryByText(SALES_NOTICE)).not.toBeInTheDocument();

    await app.user.click(screen.getByRole('checkbox', { name: 'Los precios incluyen IVA' }));
    expect(screen.getByText(SALES_NOTICE)).toBeInTheDocument();
    await app.user.click(screen.getByRole('checkbox', { name: 'Los precios incluyen IVA' }));
    expect(screen.queryByText(SALES_NOTICE)).not.toBeInTheDocument();

    await app.user.type(screen.getByLabelText('IVA (%)'), '.5');
    expect(screen.getByText(SALES_NOTICE)).toBeInTheDocument();
  });

  it('las zonas de México aparecen primero y cambiarla muestra el aviso', async () => {
    const app = open();
    await app.user.click(await screen.findByLabelText('Zona horaria'));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.slice(0, MEXICO_TIME_ZONES.length).map((o) => o.textContent)).toEqual([
      ...MEXICO_TIME_ZONES,
    ]);
    expect(options.length).toBeGreaterThan(MEXICO_TIME_ZONES.length);

    await app.user.click(screen.getByRole('option', { name: 'America/Tijuana' }));
    expect(screen.getByText(SALES_NOTICE)).toBeInTheDocument();
  });
});

describe('BranchSettingsForm: otros casos', () => {
  it('una sucursal sin datos opcionales muestra los campos vacíos', async () => {
    open(
      makeBranch({
        legalName: null,
        taxId: null,
        address: null,
        phone: null,
        email: null,
        ticketHeader: null,
        ticketFooterMessage: null,
        promoQrText: 'DESC10',
        promoQrCaption: 'Muéstralo en caja',
      }),
    );
    expect(await screen.findByLabelText('Razón social')).toHaveValue('');
    expect(screen.getByLabelText('RFC')).toHaveValue('');
    expect(screen.getByLabelText('Texto del QR de promoción')).toHaveValue('DESC10');
    const ticket = within(screen.getByTestId('ticket-preview'));
    expect(ticket.queryByText(/^RFC:/)).not.toBeInTheDocument();
    expect(ticket.getByRole('img', { name: 'PROMO:DESC10' })).toBeInTheDocument();
  });

  it('guardar sin cambios avisa y no llama a la API', async () => {
    const app = open();
    await app.user.click(await screen.findByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('No hay cambios')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `PATCH ${BRANCH_URL}`)).toHaveLength(0);
  });

  it('un umbral de stock que no es entero → error sin llamar a la API', async () => {
    const app = open();
    const threshold = await screen.findByLabelText('Stock bajo (unidades)');
    await app.user.clear(threshold);
    await app.user.type(threshold, '2.5');
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Escribe un número entero de unidades')).toBeInTheDocument();
    expect(callsTo(app.fetchMock, `PATCH ${BRANCH_URL}`)).toHaveLength(0);
  });

  it.each([
    [
      'un VALIDATION_ERROR de la zona horaria',
      () =>
        apiError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', [
          { path: 'timezone', message: 'Zona horaria no válida' },
        ]),
      'Zona horaria no válida',
    ],
    [
      'un VALIDATION_ERROR de un campo desconocido',
      () =>
        apiError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', [
          { path: 'color', message: 'No existe' },
        ]),
      'Los datos enviados no son válidos.',
    ],
    [
      'otro error',
      () => apiError(403, 'BRANCH_FORBIDDEN', 'No tienes acceso a esa sucursal.'),
      'No tienes acceso a esa sucursal.',
    ],
  ])('%s se muestra', async (_caso, response, message) => {
    const app = open(makeBranch(), { [`PATCH ${BRANCH_URL}`]: response });
    await app.user.type(await screen.findByLabelText('Nombre'), ' 2');
    await app.user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('si no se puede cargar la sucursal ofrece reintentar', async () => {
    mockFetch({
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession()),
      [`GET ${BRANCH_URL}`]: [
        () => apiError(500, 'INTERNAL_ERROR', 'Falló el servidor'),
        () => jsonResponse(200, makeBranch()),
      ],
    });
    const app = renderApp('/settings/branch');
    expect(await screen.findByText('Falló el servidor')).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Sucursal Centro');
  });

  it('en el celular la vista previa se abre con "Vista previa"', async () => {
    setScreenWidth(375);
    const app = open();
    await screen.findByLabelText('Nombre');
    expect(screen.queryByTestId('ticket-preview')).not.toBeInTheDocument();

    await app.user.click(screen.getByRole('button', { name: 'Vista previa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Vista previa del ticket' });
    expect(within(sheet).getByText('— Vista previa —')).toBeInTheDocument();
  });
});
