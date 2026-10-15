import {
  CashSessionSummaryDto,
  CloseSessionInput,
  OpenSessionInput,
  paginated,
  PaginationQuery,
  PosRegisterDto,
  PosSessionDto,
  SaleListItemDto,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { posActorOf } from './pos.actor.js';
import { SessionsService } from './sessions.service.js';

const IdParams = z.object({ id: Uuid });
const SELL = { access: { permission: 'pos.sell' }, branchScoped: true } as const;
const CLOSE = { access: { permission: 'pos.session.close' }, branchScoped: true } as const;
const tags = ['pos'];

/** Cajas y sesiones del POS (spec F8 §6). */
export const posSessionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SessionsService(app);

  app.get(
    '/cash-registers',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Cajas activas de la sucursal con su sesión abierta',
        response: { 200: z.array(PosRegisterDto) },
      },
    },
    async (request) => service.listRegisters(request.branchId!),
  );

  app.post(
    '/cash-sessions/open',
    {
      config: { access: { permission: 'pos.session.open' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Abrir una caja con su fondo inicial',
        body: OpenSessionInput,
        response: { 201: PosSessionDto },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return service.open(posActorOf(request), request.body);
    },
  );

  app.get(
    '/cash-sessions/:id',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Detalle de una sesión de caja',
        params: IdParams,
        response: { 200: PosSessionDto },
      },
    },
    async (request) => service.get(posActorOf(request), request.params.id),
  );

  app.get(
    '/cash-sessions/:id/sales',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Ventas cobradas en la sesión (historial de la caja)',
        params: IdParams,
        querystring: PaginationQuery,
        response: { 200: paginated(SaleListItemDto) },
      },
    },
    async (request) => service.sales(posActorOf(request), request.params.id, request.query),
  );

  app.post(
    '/cash-sessions/:id/close',
    {
      config: CLOSE,
      schema: {
        tags,
        summary: 'Corte ciego: cerrar la caja con el efectivo contado',
        params: IdParams,
        body: CloseSessionInput,
        response: { 200: CashSessionSummaryDto },
      },
    },
    async (request) => service.close(posActorOf(request), request.params.id, request.body),
  );

  app.get(
    '/cash-sessions/:id/summary',
    {
      config: CLOSE,
      schema: {
        tags,
        summary: 'Resumen del corte de una sesión cerrada',
        params: IdParams,
        response: { 200: CashSessionSummaryDto },
      },
    },
    async (request) => service.summary(posActorOf(request), request.params.id),
  );
};
