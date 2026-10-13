import { BranchDto, BranchUpdateInput, Uuid } from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SettingsService, type SettingsActor } from './settings.service.js';

const IdParams = z.object({ id: Uuid });
const ACCESS = { access: { permission: 'settings.branch' } } as const;

export function settingsActorOf(request: FastifyRequest): SettingsActor {
  const auth = request.auth!;
  return { userId: auth.userId, branchIds: auth.branchIds, ip: request.ip };
}

/** `/branches/:id`: datos de la sucursal y del ticket (spec F5 §6). */
export const branchesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SettingsService(app);

  app.get(
    '/:id',
    {
      config: ACCESS,
      schema: {
        tags: ['settings'],
        summary: 'Datos de una sucursal del usuario',
        params: IdParams,
        response: { 200: BranchDto },
      },
    },
    async (request) => service.getBranch(settingsActorOf(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      config: ACCESS,
      schema: {
        tags: ['settings'],
        summary: 'Editar los datos de la sucursal',
        params: IdParams,
        body: BranchUpdateInput,
        response: { 200: BranchDto },
      },
    },
    async (request) =>
      service.updateBranch(settingsActorOf(request), request.params.id, request.body),
  );
};
