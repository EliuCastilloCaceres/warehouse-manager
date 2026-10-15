import { LOCATION_COLORS } from '@warehouse-manager/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { apiError, callsTo, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { overCapacityMessage, reprintMessage } from './SetupPage';
import { makeTree, ok, treeKey, warehouseRoutes } from './testing';

const tree = makeTree();
const zoneA = tree.zones[0]!;
const rackA1 = zoneA.containers[0]!.racks[0]!;
const BATCH = `POST /api/v1/zones/${zoneA.id}/containers/batch`;
const PATCH_ZONE = `PATCH /api/v1/zones/${zoneA.id}`;
const DEACTIVATE_RACK = `POST /api/v1/racks/${rackA1.id}/deactivate`;

function start() {
  return mockFetch(
    warehouseRoutes({
      [treeKey({ includeInactive: true })]: ok(tree),
      [BATCH]: ok([]),
      [PATCH_ZONE]: ok({ ...zoneA, code: 'D', affectedRacks: 2, overCapacity: false }),
      [DEACTIVATE_RACK]: () =>
        apiError(409, 'RACK_HAS_STOCK', 'No se puede desactivar: hay stock en estas ubicaciones.', {
          locationCodes: ['A-01-01'],
        }),
    }),
  );
}

const bodyOf = (fetchMock: jest.Mock, key: string) =>
  JSON.parse(callsTo(fetchMock, key)[0]![1].body as string);

describe('SetupPage (T37)', () => {
  it('el asistente de lote envía ContainerBatchInput; la paleta muestra los 10 colores', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/setup');
    await app.user.click((await screen.findAllByRole('button', { name: 'Crear en lote' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Crear contenedores en lote' });

    const palette = within(dialog).getByRole('radiogroup', { name: 'Color' });
    const radios = within(palette).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      'Color de la zona',
      ...LOCATION_COLORS.map((c) => c.name),
    ]);

    const type = async (label: string, value: string) => {
      const field = within(dialog).getByLabelText(label);
      await app.user.clear(field);
      await app.user.type(field, value);
    };
    await type('Contenedores', '3');
    await type('Racks por contenedor', '4');
    await type('Capacidad (unidades)', '40');
    await app.user.click(within(palette).getByRole('radio', { name: /Azul/ }));
    expect(within(palette).getByRole('radio', { name: /Azul/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(callsTo(fetchMock, BATCH)).toHaveLength(1));
    expect(bodyOf(fetchMock, BATCH)).toEqual({
      count: 3,
      racksPerContainer: 4,
      capacityUnits: 40,
      labelColor: '#2563EB',
    });
  });

  it('editar un código pide confirmar la reimpresión y solo envía el PATCH al confirmar', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de zona A' }));
    await app.user.click(await screen.findByRole('button', { name: 'Editar código' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar código' });
    await app.user.type(within(dialog).getByLabelText('Nuevo código (actual: A)'), 'D');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(reprintMessage(2))).toBeInTheDocument();
    expect(callsTo(fetchMock, PATCH_ZONE)).toHaveLength(0);
    await app.user.click(screen.getByRole('button', { name: 'Cambiar código' }));
    await waitFor(() => expect(callsTo(fetchMock, PATCH_ZONE)).toHaveLength(1));
    expect(bodyOf(fetchMock, PATCH_ZONE)).toEqual({ code: 'D' });
  });

  it('bajar la capacidad por debajo de la ocupación muestra el aviso', async () => {
    start();
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rack' });
    const capacity = within(dialog).getByLabelText('Capacidad (unidades)');
    expect(capacity).toHaveValue('40');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await app.user.clear(capacity);
    await app.user.type(capacity, '5');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(overCapacityMessage(10, 5));
  });

  it('desactivar un rack con stock avisa con sus ubicaciones', async () => {
    const fetchMock = start();
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Desactivar' }));
    await app.user.click(
      within(await screen.findByRole('dialog', { name: '¿Desactivar rack A-01-01?' })).getByRole(
        'button',
        { name: 'Desactivar' },
      ),
    );
    await waitFor(() => expect(callsTo(fetchMock, DEACTIVATE_RACK)).toHaveLength(1));
    expect(
      await screen.findByText('No se puede desactivar: hay stock en estas ubicaciones. A-01-01'),
    ).toBeInTheDocument();
  });

  it('staging aparece bloqueada y sin acciones', async () => {
    start();
    renderApp('/warehouse/setup');
    expect(await screen.findByLabelText('Bloqueada')).toBeInTheDocument();
    expect(screen.getByText('STG-01-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Opciones de .*STG/ })).not.toBeInTheDocument();
  });
});

describe('SetupPage: crear, editar, reactivar y borrar', () => {
  const containerA = zoneA.containers[0]!;
  // El mismo árbol, con la zona B inactiva.
  const zoneB = { ...tree.zones[1]!, isActive: false };
  const inactiveTree = { ...tree, zones: [zoneA, zoneB] };
  const KEYS = {
    createZone: `POST /api/v1/warehouses/${tree.warehouse.id}/zones`,
    createContainer: `POST /api/v1/zones/${zoneA.id}/containers`,
    createRack: `POST /api/v1/containers/${containerA.id}/racks`,
    rackBatch: `POST /api/v1/containers/${containerA.id}/racks/batch`,
    patchRack: `PATCH /api/v1/racks/${rackA1.id}`,
    patchContainer: `PATCH /api/v1/containers/${containerA.id}`,
    reactivateZone: `POST /api/v1/zones/${zoneB.id}/reactivate`,
    deleteRack: `DELETE /api/v1/racks/${rackA1.id}`,
  };
  const noContent = () =>
    ({ ok: true, status: 204, json: async () => undefined }) as unknown as Response;

  function startAll(createZone: () => Response = ok(zoneA)) {
    return mockFetch(
      warehouseRoutes({
        [treeKey({ includeInactive: true })]: ok(inactiveTree),
        [KEYS.createZone]: createZone,
        [KEYS.createContainer]: ok(containerA),
        [KEYS.createRack]: ok(rackA1),
        [KEYS.rackBatch]: ok([]),
        [KEYS.patchRack]: ok({ ...rackA1, capacityUnits: 5, affectedRacks: 0, overCapacity: true }),
        [KEYS.patchContainer]: ok({ ...containerA, affectedRacks: 0, overCapacity: false }),
        [PATCH_ZONE]: ok({ ...zoneA, affectedRacks: 0, overCapacity: false }),
        [KEYS.reactivateZone]: ok(zoneB),
        [KEYS.deleteRack]: noContent,
      }),
    );
  }

  const dialogNamed = (name: string) => screen.findByRole('dialog', { name });
  const fill = async (
    app: ReturnType<typeof renderApp>,
    dialog: HTMLElement,
    label: string,
    value: string,
  ) => {
    const field = within(dialog).getByLabelText(label);
    await app.user.clear(field);
    await app.user.type(field, value);
  };

  it('crea una zona con código, nombre, prioridad y color', async () => {
    const fetchMock = startAll();
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Zona' }));
    const dialog = await dialogNamed('Zona');
    await fill(app, dialog, 'Código (opcional)', 'c');
    await fill(app, dialog, 'Nombre', 'Accesorios');
    await fill(app, dialog, 'Prioridad (menor = preferida)', '2');
    await app.user.click(within(dialog).getByRole('radio', { name: /Verde/ }));
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.createZone)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.createZone)).toEqual({
      name: 'Accesorios',
      color: '#16A34A',
      priority: 2,
      code: 'c',
    });
  });

  it('un error al guardar se avisa y el formulario sigue abierto', async () => {
    startAll(() => apiError(409, 'CONFLICT', 'Ya existe una zona con ese código.'));
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Zona' }));
    const dialog = await dialogNamed('Zona');
    await fill(app, dialog, 'Nombre', 'Otra');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Ya existe una zona con ese código.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Zona' })).toBeInTheDocument();
  });

  it('crea un contenedor, un rack y racks en lote', async () => {
    const fetchMock = startAll();
    const app = renderApp('/warehouse/setup');

    await app.user.click((await screen.findAllByRole('button', { name: 'Contenedor' }))[0]!);
    let dialog = await dialogNamed('Contenedor');
    await fill(app, dialog, 'Nombre', 'Pared norte');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.createContainer)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.createContainer)).toEqual({ name: 'Pared norte' });

    await app.user.click((await screen.findAllByRole('button', { name: 'Rack' }))[0]!);
    dialog = await dialogNamed('Rack');
    await fill(app, dialog, 'Capacidad (unidades)', '30');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.createRack)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.createRack)).toEqual({ capacityUnits: 30, labelColor: null });

    await app.user.click((await screen.findAllByRole('button', { name: 'Racks en lote' }))[0]!);
    dialog = await dialogNamed('Crear racks en lote');
    await fill(app, dialog, 'Racks', '5');
    await fill(app, dialog, 'Capacidad (unidades)', '20');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.rackBatch)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.rackBatch)).toEqual({
      count: 5,
      capacityUnits: 20,
      labelColor: null,
    });
  });

  it('editar zona, contenedor y rack; la respuesta con overCapacity avisa', async () => {
    const fetchMock = startAll();
    const app = renderApp('/warehouse/setup');

    await app.user.click(await screen.findByRole('button', { name: 'Opciones de zona A' }));
    await app.user.click(await screen.findByRole('button', { name: 'Editar' }));
    let dialog = await dialogNamed('Zona');
    expect(within(dialog).queryByLabelText('Código (opcional)')).not.toBeInTheDocument();
    await fill(app, dialog, 'Nombre', 'Calzado');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, PATCH_ZONE)).toHaveLength(1));
    expect(bodyOf(fetchMock, PATCH_ZONE)).toEqual({
      name: 'Calzado',
      color: '#2563EB',
      priority: 0,
    });

    await app.user.click(
      await screen.findByRole('button', { name: 'Opciones de contenedor A-01' }),
    );
    await app.user.click(await screen.findByRole('button', { name: 'Editar' }));
    dialog = await dialogNamed('Contenedor');
    await fill(app, dialog, 'Nombre', 'Norte');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.patchContainer)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.patchContainer)).toEqual({ name: 'Norte' });

    await app.user.click(await screen.findByRole('button', { name: 'Opciones de rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Editar' }));
    dialog = await dialogNamed('Rack');
    await fill(app, dialog, 'Capacidad (unidades)', '5');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.patchRack)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.patchRack)).toEqual({ capacityUnits: 5, labelColor: null });
    expect(await screen.findByText(overCapacityMessage(10, 5))).toBeInTheDocument();
  });

  it('editar el código de un rack pide confirmar la reimpresión de 1 rack', async () => {
    const fetchMock = startAll();
    const app = renderApp('/warehouse/setup');
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Editar código' }));
    const dialog = await dialogNamed('Editar código');
    await app.user.type(within(dialog).getByLabelText('Nuevo código (actual: 01)'), '7');
    await app.user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(reprintMessage(1))).toBeInTheDocument();
    await app.user.click(screen.getByRole('button', { name: 'Cambiar código' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.patchRack)).toHaveLength(1));
    expect(bodyOf(fetchMock, KEYS.patchRack)).toEqual({ code: '7' });
  });

  it('una zona inactiva se reactiva; un rack se elimina tras confirmar', async () => {
    const fetchMock = startAll();
    const app = renderApp('/warehouse/setup');
    expect(await screen.findAllByText('(inactivo)')).not.toHaveLength(0);
    await app.user.click(await screen.findByRole('button', { name: 'Opciones de zona B' }));
    await app.user.click(await screen.findByRole('button', { name: 'Reactivar' }));
    await waitFor(() => expect(callsTo(fetchMock, KEYS.reactivateZone)).toHaveLength(1));

    await app.user.click(await screen.findByRole('button', { name: 'Opciones de rack A-01-01' }));
    await app.user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await app.user.click(
      within(await dialogNamed('¿Eliminar rack A-01-01?')).getByRole('button', {
        name: 'Eliminar',
      }),
    );
    await waitFor(() => expect(callsTo(fetchMock, KEYS.deleteRack)).toHaveLength(1));
    expect(await screen.findByText('Eliminado')).toBeInTheDocument();
  });
});
