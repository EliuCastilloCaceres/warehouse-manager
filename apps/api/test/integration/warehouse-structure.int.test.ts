import {
  ContainerDto,
  RackDto,
  WarehouseDto,
  ZoneChangeDto,
  ZoneDto,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestApp } from './helpers/app.js';
import { createAndLogin, loginSeeded } from './helpers/auth.js';
import { createTestClient } from './helpers/db.js';
import { resetWithSeed } from './helpers/seed.js';
import {
  type Api,
  apiAs,
  createProduct,
  createStructure,
  putStock,
  warehouseOf,
} from './helpers/warehouse.js';

describe('estructura del almacén', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let admin: Api;
  let adminId: string;
  let seller: Api;
  let clerk: Api;
  let s1: Awaited<ReturnType<typeof warehouseOf>>;
  let s2: Awaited<ReturnType<typeof warehouseOf>>;

  beforeAll(async () => {
    prisma = createTestClient();
    await resetWithSeed(prisma);
    app = await createTestApp(prisma);
    const adminSession = await loginSeeded(app, prisma, 'admin');
    admin = apiAs(app, adminSession.accessToken);
    adminId = adminSession.userId;
    seller = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'vendedor', role: 'SELLER' })).accessToken,
    );
    clerk = apiAs(
      app,
      (await createAndLogin(app, prisma, { username: 'almacen', role: 'WAREHOUSE_CLERK' }))
        .accessToken,
    );
    s1 = await warehouseOf(prisma, 'S1');
    s2 = await warehouseOf(prisma, 'S2');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const rackCodesOf = async (containerId: string) =>
    (await prisma.rack.findMany({ where: { containerId }, orderBy: { code: 'asc' } })).map(
      (r) => r.locationCode,
    );

  describe('GET /warehouses y acceso por sucursal (T6)', () => {
    it('devuelve el almacén de la sucursal actual o la del header', async () => {
      const own = await admin.get('/warehouses');
      expect(own.statusCode).toBe(200);
      expect(
        WarehouseDto.array()
          .parse(own.json())
          .map((w) => w.id),
      ).toEqual([s1.id]);

      const other = await apiAs(
        app,
        (await loginSeeded(app, prisma, 'admin')).accessToken,
        s2.branchId,
      ).get('/warehouses');
      expect(other.json().map((w: WarehouseDto) => w.id)).toEqual([s2.id]);
    });

    it('un :id de un almacén de una sucursal no asignada → 403 BRANCH_FORBIDDEN', async () => {
      const res = await clerk.post(`/warehouses/${s2.id}/zones`, { name: 'Ajena' });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('BRANCH_FORBIDDEN');
      const tree = await clerk.get(`/warehouses/${s2.id}/tree`);
      expect(tree.json().code).toBe('BRANCH_FORBIDDEN');
      const zone = await prisma.zone.findFirstOrThrow({ where: { warehouseId: s2.id } });
      expect((await clerk.patch(`/zones/${zone.id}`, { name: 'X' })).json().code).toBe(
        'BRANCH_FORBIDDEN',
      );
    });

    it('un almacén que no existe → 404', async () => {
      const res = await admin.post('/warehouses/00000000-0000-4000-8000-000000000000/zones', {
        name: 'X',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('crear (T7)', () => {
    it('zona, contenedor y rack sin código toman el siguiente libre', async () => {
      const first = ZoneDto.parse(
        (await admin.post(`/warehouses/${s1.id}/zones`, { name: 'Calzado dama' })).json(),
      );
      expect(first).toMatchObject({ code: 'A', color: null, priority: 0, isStaging: false });
      const second = await admin.post(`/warehouses/${s1.id}/zones`, {
        name: 'Bolsos',
        color: '#16A34A',
      });
      expect(second.statusCode).toBe(201);
      expect(second.json()).toMatchObject({ code: 'B', color: '#16A34A' });

      const c1 = ContainerDto.parse((await admin.post(`/zones/${first.id}/containers`, {})).json());
      const c2 = ContainerDto.parse(
        (await admin.post(`/zones/${first.id}/containers`, { name: 'Pared norte' })).json(),
      );
      expect([c1.code, c2.code, c2.name]).toEqual(['01', '02', 'Pared norte']);

      const r1 = RackDto.parse(
        (await admin.post(`/containers/${c2.id}/racks`, { capacityUnits: 40 })).json(),
      );
      const r2 = RackDto.parse(
        (await admin.post(`/containers/${c2.id}/racks`, { capacityUnits: 20, code: '7' })).json(),
      );
      expect(r1).toMatchObject({ code: '01', locationCode: 'A-02-01', capacityUnits: 40 });
      expect(r2).toMatchObject({ code: '07', locationCode: 'A-02-07', warehouseId: s1.id });
    });

    it('código repetido → 409 CONFLICT; color fuera de la paleta → 400', async () => {
      const dup = await admin.post(`/warehouses/${s1.id}/zones`, { code: 'A', name: 'Otra' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('CONFLICT');
      const color = await admin.post(`/warehouses/${s1.id}/zones`, {
        name: 'Negra',
        color: '#000000',
      });
      expect(color.statusCode).toBe(400);
      expect(color.json().code).toBe('VALIDATION_ERROR');
    });

    it('sin warehouse.manage → 403', async () => {
      const res = await seller.post(`/warehouses/${s1.id}/zones`, { name: 'X' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'FORBIDDEN',
        details: { permission: 'warehouse.manage' },
      });
    });

    it('no se crea estructura bajo una zona o contenedor inactivos', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'Q' });
      await prisma.zone.update({ where: { id: s.zoneId }, data: { isActive: false } });
      expect((await admin.post(`/zones/${s.zoneId}/containers`, {})).statusCode).toBe(409);
      await prisma.container.update({
        where: { id: s.containerIds['01'] },
        data: { isActive: false },
      });
      expect(
        (await admin.post(`/containers/${s.containerIds['01']}/racks`, { capacityUnits: 1 }))
          .statusCode,
      ).toBe(409);
    });
  });

  describe('lotes (T8)', () => {
    it('10 racks de capacidad 40 → 01…10; con 01–03 existentes empieza en 04', async () => {
      const s = await createStructure(prisma, s1.id, {
        zone: 'L',
        containers: ['01', '02'],
        racks: ['01', '02', '03'],
      });
      await prisma.rack.deleteMany({ where: { containerId: s.containerIds['01'] } });

      const res = await admin.post(`/containers/${s.containerIds['01']}/racks/batch`, {
        count: 10,
        capacityUnits: 40,
        labelColor: '#2563EB',
      });
      expect(res.statusCode).toBe(201);
      const racks = RackDto.array().parse(res.json());
      expect(racks.map((r) => r.locationCode)).toEqual(
        Array.from({ length: 10 }, (_, i) => `L-01-${String(i + 1).padStart(2, '0')}`),
      );
      expect(racks.every((r) => r.capacityUnits === 40 && r.labelColor === '#2563EB')).toBe(true);

      const more = await admin.post(`/containers/${s.containerIds['02']}/racks/batch`, {
        count: 2,
        capacityUnits: 10,
      });
      expect(more.json().map((r: RackDto) => r.locationCode)).toEqual(['L-02-04', 'L-02-05']);
    });

    it('un lote que pasaría de 99 → 409 STRUCTURE_FULL sin escrituras', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'M', racks: ['95'] });
      const res = await admin.post(`/containers/${s.containerIds['01']}/racks/batch`, {
        count: 5,
        capacityUnits: 10,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('STRUCTURE_FULL');
      expect(await rackCodesOf(s.containerIds['01']!)).toEqual(['M-01-95']);

      const ok = await admin.post(`/containers/${s.containerIds['01']}/racks/batch`, {
        count: 4,
        capacityUnits: 10,
      });
      expect(ok.json().map((r: RackDto) => r.code)).toEqual(['96', '97', '98', '99']);
      const full = await admin.post(`/containers/${s.containerIds['01']}/racks`, {
        capacityUnits: 1,
      });
      expect(full.statusCode).toBe(201);
      expect(full.json().code).toBe('01'); // con 99 ocupado, un rack suelto toma el primer hueco
    });

    it('3 contenedores con 4 racks cada uno → 12 racks', async () => {
      const zone = ZoneDto.parse(
        (await admin.post(`/warehouses/${s1.id}/zones`, { code: 'N', name: 'Lote' })).json(),
      );
      const res = await admin.post(`/zones/${zone.id}/containers/batch`, {
        count: 3,
        racksPerContainer: 4,
        capacityUnits: 30,
        labelColor: '#DC2626',
      });
      expect(res.statusCode).toBe(201);
      const containers = ContainerDto.array().parse(res.json());
      expect(containers.map((c) => c.code)).toEqual(['01', '02', '03']);
      const racks = await prisma.rack.findMany({
        where: { container: { zoneId: zone.id } },
        orderBy: { locationCode: 'asc' },
      });
      expect(racks).toHaveLength(12);
      expect(racks[0]).toMatchObject({ locationCode: 'N-01-01', capacityUnits: 30 });
      expect(racks[11]).toMatchObject({ locationCode: 'N-03-04', labelColor: '#DC2626' });

      const noCapacity = await admin.post(`/zones/${zone.id}/containers/batch`, {
        count: 1,
        racksPerContainer: 2,
      });
      expect(noCapacity.statusCode).toBe(400);
      const empty = await admin.post(`/zones/${zone.id}/containers/batch`, { count: 2 });
      expect(empty.json().map((c: ContainerDto) => c.code)).toEqual(['04', '05']);
    });
  });

  describe('cambio de código (T9)', () => {
    it('zona A → D recalcula todos sus racks, conserva el stock y lo audita', async () => {
      const s = await createStructure(prisma, s1.id, {
        zone: 'E',
        containers: ['01', '02'],
        racks: ['01', '02'],
      });
      const { variantIds } = await createProduct(prisma, 'COD0001');
      await putStock(prisma, {
        variantId: variantIds[0]!,
        rackId: s.rackIds['E-01-01']!,
        quantity: 5,
        userId: adminId,
      });

      const res = await admin.patch(`/zones/${s.zoneId}`, { code: 'F', name: 'Calzado' });
      expect(res.statusCode).toBe(200);
      expect(ZoneChangeDto.parse(res.json())).toMatchObject({
        code: 'F',
        name: 'Calzado',
        affectedRacks: 4,
        overCapacity: false,
      });
      const racks = await prisma.rack.findMany({
        where: { container: { zoneId: s.zoneId } },
        orderBy: { locationCode: 'asc' },
      });
      expect(racks.map((r) => r.locationCode)).toEqual([
        'F-01-01',
        'F-01-02',
        'F-02-01',
        'F-02-02',
      ]);
      const stock = await prisma.stockLocation.findFirstOrThrow({
        where: { rackId: s.rackIds['E-01-01'] },
      });
      expect(stock.quantity).toBe(5);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'warehouse.code_change', entityId: s.zoneId },
      });
      expect(audit).toMatchObject({ entity: 'Zone', userId: adminId });
      expect(audit.payload).toMatchObject({
        from: 'E',
        to: 'F',
        locationCodes: expect.arrayContaining([{ from: 'E-01-01', to: 'F-01-01' }]),
      });
    });

    it('cambiar a un código existente → 409 CONFLICT sin cambios', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'G', containers: ['01', '02'] });
      const zone = await admin.patch(`/zones/${s.zoneId}`, { code: 'A', name: 'Renombrada' });
      expect(zone.statusCode).toBe(409);
      expect(zone.json().code).toBe('CONFLICT');
      expect(await prisma.zone.findUniqueOrThrow({ where: { id: s.zoneId } })).toMatchObject({
        code: 'G',
        name: 'Zona G',
      });
      const container = await admin.patch(`/containers/${s.containerIds['01']}`, { code: '2' });
      expect(container.statusCode).toBe(409);
      expect(await rackCodesOf(s.containerIds['01']!)).toEqual(['G-01-01']);
    });

    it('cambiar el código de un contenedor o de un rack afecta solo a sus racks', async () => {
      const s = await createStructure(prisma, s1.id, {
        zone: 'H',
        containers: ['01', '02'],
        racks: ['01', '02'],
      });
      const container = await admin.patch(`/containers/${s.containerIds['01']}`, { code: '05' });
      expect(container.json()).toMatchObject({ code: '05', affectedRacks: 2 });
      expect(await rackCodesOf(s.containerIds['01']!)).toEqual(['H-05-01', 'H-05-02']);

      const rack = await admin.patch(`/racks/${s.rackIds['H-02-02']}`, { code: '09' });
      expect(rack.json()).toMatchObject({ locationCode: 'H-02-09', affectedRacks: 1 });
      expect(await rackCodesOf(s.containerIds['02']!)).toEqual(['H-02-01', 'H-02-09']);
      expect(
        await prisma.auditLog.count({
          where: { action: 'warehouse.code_change', entityId: s.rackIds['H-02-02'] },
        }),
      ).toBe(1);

      const same = await admin.patch(`/racks/${s.rackIds['H-02-01']}`, { code: '01' });
      expect(same.json()).toMatchObject({ affectedRacks: 0 });
      const dup = await admin.patch(`/racks/${s.rackIds['H-02-01']}`, { code: '09' });
      expect(dup.statusCode).toBe(409);
    });
  });

  describe('capacidad por debajo de la ocupación (T10)', () => {
    it('se guarda con aviso, el árbol lo marca en rojo y bloquea entradas sin override', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'T', capacity: 40 });
      const rackId = s.rackIds['T-01-01']!;
      const { variantIds } = await createProduct(prisma, 'CAP0001', ['NEG', 'CAF']);
      await putStock(prisma, { variantId: variantIds[0]!, rackId, quantity: 12, userId: adminId });

      const res = await admin.patch(`/racks/${rackId}`, { capacityUnits: 10 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ capacityUnits: 10, overCapacity: true, affectedRacks: 0 });
      const ok = await admin.patch(`/racks/${rackId}`, { labelColor: '#7C3AED' });
      expect(ok.json()).toMatchObject({ overCapacity: true, labelColor: '#7C3AED' });

      const zone = (await admin.get(`/warehouses/${s1.id}/tree`))
        .json()
        .zones.find((z: { code: string }) => z.code === 'T');
      expect(zone.containers[0].racks[0].occupancy).toMatchObject({
        capacity: 10,
        occupied: 12,
        free: -2,
        pct: 120,
        level: 'red',
      });

      const putaway = { variantId: variantIds[1], rackId, quantity: 1, source: 'NEW' };
      const blocked = await clerk.post('/inventory/putaway', putaway);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().code).toBe('RACK_CAPACITY_EXCEEDED');

      const forbidden = await clerk.post('/inventory/putaway', {
        ...putaway,
        overrideCapacity: true,
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().details).toEqual({ permission: 'inventory.override_capacity' });

      const overridden = await admin.post('/inventory/putaway', {
        ...putaway,
        overrideCapacity: true,
      });
      expect(overridden.statusCode).toBe(200);
      expect(overridden.json().movements[0].capacityOverridden).toBe(true);
    });
  });

  describe('desactivar y reactivar (T11)', () => {
    it('un rack con stock → 409 RACK_HAS_STOCK con su código', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'J', racks: ['01', '02'] });
      const { variantIds } = await createProduct(prisma, 'DES0001');
      await putStock(prisma, {
        variantId: variantIds[0]!,
        rackId: s.rackIds['J-01-01']!,
        quantity: 2,
        userId: adminId,
      });
      const res = await admin.post(`/racks/${s.rackIds['J-01-01']}/deactivate`);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'RACK_HAS_STOCK',
        details: { locationCodes: ['J-01-01'] },
      });
      const container = await admin.post(`/containers/${s.containerIds['01']}/deactivate`);
      expect(container.json()).toMatchObject({
        code: 'RACK_HAS_STOCK',
        details: { locationCodes: ['J-01-01'] },
      });
      expect((await admin.post(`/racks/${s.rackIds['J-01-02']}/deactivate`)).statusCode).toBe(200);
    });

    it('un contenedor sin stock desactiva sus racks; reactivar es por nivel', async () => {
      const s = await createStructure(prisma, s1.id, {
        zone: 'K',
        containers: ['01', '02'],
        racks: ['01', '02'],
      });
      const res = await admin.post(`/containers/${s.containerIds['01']}/deactivate`);
      expect(res.statusCode).toBe(200);
      expect(ContainerDto.parse(res.json()).isActive).toBe(false);
      const racks = await prisma.rack.findMany({
        where: { containerId: s.containerIds['01'] },
      });
      expect(racks.every((r) => !r.isActive)).toBe(true);
      expect(
        await prisma.auditLog.findFirst({
          where: { action: 'warehouse.deactivate', entityId: s.containerIds['01'] },
        }),
      ).toMatchObject({
        entity: 'Container',
        payload: { code: 'K-01', racks: ['K-01-01', 'K-01-02'] },
      });

      const rack = await admin.post(`/racks/${s.rackIds['K-01-01']}/reactivate`);
      expect(rack.statusCode).toBe(409);
      expect(rack.json().code).toBe('CONFLICT');

      const container = await admin.post(`/containers/${s.containerIds['01']}/reactivate`);
      expect(container.json().isActive).toBe(true);
      expect(
        (await prisma.rack.findUniqueOrThrow({ where: { id: s.rackIds['K-01-01'] } })).isActive,
      ).toBe(false);
      expect((await admin.post(`/racks/${s.rackIds['K-01-01']}/reactivate`)).json().isActive).toBe(
        true,
      );

      const zone = await admin.post(`/zones/${s.zoneId}/deactivate`);
      expect(zone.json().isActive).toBe(false);
      expect(await prisma.container.count({ where: { zoneId: s.zoneId, isActive: true } })).toBe(0);
    });

    it('el árbol por defecto no muestra inactivos y con includeInactive=true sí', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'P', racks: ['01', '02'] });
      await admin.post(`/racks/${s.rackIds['P-01-02']}/deactivate`);
      const zoneOf = async (query: string) =>
        (await admin.get(`/warehouses/${s1.id}/tree${query}`))
          .json()
          .zones.find((z: { code: string }) => z.code === 'P');
      const active = await zoneOf('');
      expect(active.containers[0].racks.map((r: RackDto) => r.code)).toEqual(['01']);
      const all = await zoneOf('?includeInactive=true');
      expect(all.containers[0].racks.map((r: RackDto) => r.code)).toEqual(['01', '02']);

      await admin.post(`/zones/${s.zoneId}/deactivate`);
      expect(await zoneOf('')).toBeUndefined();
      expect((await zoneOf('?includeInactive=true')).isActive).toBe(false);
    });
  });

  describe('borrar (T12)', () => {
    it('un rack nunca usado → 204; uno con movimientos → 409 STRUCTURE_HAS_HISTORY', async () => {
      const s = await createStructure(prisma, s1.id, { zone: 'R', racks: ['01', '02'] });
      const { variantIds } = await createProduct(prisma, 'BOR0001');
      await putStock(prisma, {
        variantId: variantIds[0]!,
        rackId: s.rackIds['R-01-02']!,
        quantity: 1,
        userId: adminId,
      });

      const res = await admin.delete(`/racks/${s.rackIds['R-01-01']}`);
      expect(res.statusCode).toBe(204);
      expect(await prisma.rack.findUnique({ where: { id: s.rackIds['R-01-01'] } })).toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { action: 'warehouse.delete', entityId: s.rackIds['R-01-01'] },
        }),
      ).toBe(1);

      const used = await admin.delete(`/racks/${s.rackIds['R-01-02']}`);
      expect(used.statusCode).toBe(409);
      expect(used.json().code).toBe('STRUCTURE_HAS_HISTORY');
      expect((await admin.delete(`/zones/${s.zoneId}`)).json().code).toBe('STRUCTURE_HAS_HISTORY');
    });

    it('borrar una zona cuyos racks nunca se usaron borra todo su subárbol', async () => {
      const s = await createStructure(prisma, s1.id, {
        zone: 'S',
        containers: ['01', '02'],
        racks: ['01', '02'],
      });
      expect((await admin.delete(`/zones/${s.zoneId}`)).statusCode).toBe(204);
      expect(await prisma.zone.findUnique({ where: { id: s.zoneId } })).toBeNull();
      expect(await prisma.container.count({ where: { zoneId: s.zoneId } })).toBe(0);
      expect(await prisma.rack.count({ where: { id: { in: Object.values(s.rackIds) } } })).toBe(0);
    });
  });

  describe('staging bloqueado (T13)', () => {
    it.each([
      ['PATCH zona', () => admin.patch(`/zones/${s1.staging.zoneId}`, { name: 'Otra' })],
      [
        'PATCH contenedor',
        () => admin.patch(`/containers/${s1.staging.containerId}`, { name: 'X' }),
      ],
      ['PATCH rack', () => admin.patch(`/racks/${s1.staging.rackId}`, { capacityUnits: 5 })],
      ['desactivar zona', () => admin.post(`/zones/${s1.staging.zoneId}/deactivate`)],
      [
        'desactivar contenedor',
        () => admin.post(`/containers/${s1.staging.containerId}/deactivate`),
      ],
      ['desactivar rack', () => admin.post(`/racks/${s1.staging.rackId}/deactivate`)],
      ['reactivar rack', () => admin.post(`/racks/${s1.staging.rackId}/reactivate`)],
      ['borrar zona', () => admin.delete(`/zones/${s1.staging.zoneId}`)],
      ['borrar contenedor', () => admin.delete(`/containers/${s1.staging.containerId}`)],
      ['borrar rack', () => admin.delete(`/racks/${s1.staging.rackId}`)],
      ['agregar contenedor', () => admin.post(`/zones/${s1.staging.zoneId}/containers`, {})],
      [
        'agregar contenedores en lote',
        () => admin.post(`/zones/${s1.staging.zoneId}/containers/batch`, { count: 1 }),
      ],
      [
        'agregar rack',
        () => admin.post(`/containers/${s1.staging.containerId}/racks`, { capacityUnits: 5 }),
      ],
      [
        'agregar racks en lote',
        () =>
          admin.post(`/containers/${s1.staging.containerId}/racks/batch`, {
            count: 1,
            capacityUnits: 5,
          }),
      ],
    ])('%s → 409 STRUCTURE_LOCKED', async (_caso, call) => {
      const res = await call();
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('STRUCTURE_LOCKED');
    });

    it('el staging sigue intacto', async () => {
      expect(
        await prisma.rack.findUniqueOrThrow({ where: { id: s1.staging.rackId } }),
      ).toMatchObject({ locationCode: 'STG-01-01', isActive: true });
      expect(await prisma.container.count({ where: { zoneId: s1.staging.zoneId } })).toBe(1);
    });
  });
});
