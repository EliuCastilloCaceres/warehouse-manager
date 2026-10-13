import { CashRegisterDto, CashRegisterUpdateInput, Uuid } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { settingsActorOf } from './branches.routes.js';
import { SettingsService } from './settings.service.js';

const IdParams = z.object({ id: Uuid });
const ACCESS = { access: { permission: 'settings.registers' } } as const;

/** `/cash-registers`: se editan nombre y código; no se agregan ni se eliminan (spec F5 §6). */
export const cashRegistersRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SettingsService(app);

  app.get(
    '/',
    {
      config: { ...ACCESS, branchScoped: true },
      schema: {
        tags: ['settings'],
        summary: 'Cajas de la sucursal actual',
        response: { 200: z.array(CashRegisterDto) },
      },
    },
    async (request) => service.listCashRegisters(request.branchId!),
  );

  app.get(
    '/:id',
    {
      config: ACCESS,
      schema: {
        tags: ['settings'],
        summary: 'Detalle de una caja',
        params: IdParams,
        response: { 200: CashRegisterDto },
      },
    },
    async (request) => service.getCashRegister(settingsActorOf(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: ACCESS,
      schema: {
        tags: ['settings'],
        summary: 'Editar el nombre o el código de una caja',
        params: IdParams,
        body: CashRegisterUpdateInput,
        response: { 200: CashRegisterDto },
      },
    },
    async (request) =>
      service.updateCashRegister(settingsActorOf(request), request.params.id, request.body),
  );
};
