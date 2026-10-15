import { LocateQuery, LocateResultDto, TicketBranchDto } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { InventoryQueries } from '../inventory/inventory.queries.js';
import { ticketBranchOf } from './sales.service.js';

const SELL = { access: { permission: 'pos.sell' }, branchScoped: true } as const;
const tags = ['pos'];

/** Datos de ticket de la sucursal y búsqueda de productos para vender (spec F8 §6). */
export const posRoutes: FastifyPluginAsyncZod = async (app) => {
  const queries = new InventoryQueries(app);

  app.get(
    '/branch',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Datos de ticket de la sucursal actual',
        response: { 200: TicketBranchDto },
      },
    },
    async (request) => ticketBranchOf(app.prisma, request.branchId!),
  );

  // Reutiliza `locate` de F7 sin exigir `warehouse.read`.
  app.get(
    '/lookup',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Buscar un producto para vender: existencias, ubicaciones y otras sucursales',
        querystring: LocateQuery,
        response: { 200: LocateResultDto },
      },
    },
    async (request) =>
      queries.locate(request.query.code, request.branchId!, request.auth!.permissions),
  );
};
