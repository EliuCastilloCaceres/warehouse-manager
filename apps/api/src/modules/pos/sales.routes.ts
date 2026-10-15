import { SaleCancelInput, SaleTicketDto, Uuid } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { posActorOf } from './pos.actor.js';
import { SalesService } from './sales.service.js';

const IdParams = z.object({ id: Uuid });
const tags = ['pos'];

/** Ticket y cancelación de ventas (spec F8 §6). */
export const posSalesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SalesService(app);

  app.get(
    '/sales/:id/ticket',
    {
      config: { access: { permission: 'pos.sell' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Ticket de una venta (para reimprimir)',
        params: IdParams,
        response: { 200: SaleTicketDto },
      },
    },
    async (request) => service.ticket(posActorOf(request), request.params.id),
  );

  app.post(
    '/sales/:id/cancel',
    {
      config: { access: { permission: 'pos.sale.cancel' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Cancelar una venta completa (con su caja abierta)',
        params: IdParams,
        body: SaleCancelInput,
        response: { 200: SaleTicketDto },
      },
    },
    async (request) => service.cancel(posActorOf(request), request.params.id, request.body),
  );
};
