import {
  colorName,
  LOCATION_LABELS_MAX,
  LocationLabelDto,
  LocationLabelsQuery,
  toLocationQr,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, validationError } from '../../core/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { warehouseActorOf } from './structure.routes.js';
import { StructureService } from './structure.service.js';

/** Racks del alcance: con ids explícitos de rack, tal cual; en los demás, solo los activos. */
function scopeWhere(query: LocationLabelsQuery): Prisma.RackWhereInput {
  const ids = query.ids ?? [];
  switch (query.scope) {
    case 'rack':
      return { id: { in: ids } };
    case 'container':
      return { containerId: { in: ids }, isActive: true };
    case 'zone':
      return { container: { zoneId: { in: ids } }, isActive: true };
    default:
      return { isActive: true };
  }
}

/** `GET /warehouses/:id/labels`: datos de las etiquetas de ubicación (spec F7 §3). */
export const locationLabelsRoutes: FastifyPluginAsyncZod = async (app) => {
  const structure = new StructureService(app);

  app.get(
    '/warehouses/:id/labels',
    {
      config: { access: { permission: 'warehouse.labels' } },
      schema: {
        tags: ['warehouse'],
        summary: 'Etiquetas de ubicación de un rack, contenedor, zona o del almacén',
        params: z.object({ id: Uuid }),
        querystring: LocationLabelsQuery,
        response: { 200: z.array(LocationLabelDto) },
      },
    },
    async (request) => {
      const warehouse = await structure.loadWarehouse(warehouseActorOf(request), request.params.id);
      const where = { ...scopeWhere(request.query), warehouseId: warehouse.id };
      const count = await app.prisma.rack.count({ where });
      if (count > LOCATION_LABELS_MAX) {
        throw validationError('scope', `Máximo ${LOCATION_LABELS_MAX} etiquetas por impresión`);
      }
      if (count === 0 && request.query.scope !== 'warehouse') {
        throw new DomainError('NOT_FOUND', { message: 'No hay ubicaciones en ese alcance.' });
      }
      const racks = await app.prisma.rack.findMany({
        where,
        orderBy: { locationCode: 'asc' },
        include: { container: { include: { zone: true } } },
      });
      return racks.map((rack) => {
        const { zone } = rack.container;
        const colorHex = rack.labelColor ?? zone.color;
        return {
          rackId: rack.id,
          locationCode: rack.locationCode,
          qrPayload: toLocationQr(rack.locationCode),
          zoneCode: zone.code,
          zoneName: zone.name,
          containerName: rack.container.name,
          capacityUnits: rack.capacityUnits,
          isStaging: zone.isStaging,
          colorHex,
          colorName: colorName(colorHex),
        };
      });
    },
  );
};
