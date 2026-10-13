import { PermissionGroupDto, RoleWithPermissionsDto } from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UsersService } from './users.service.js';

/** `/roles` y `/permissions`: solo lectura; los roles del sistema no se editan en el MVP. */
export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new UsersService(app);

  app.get(
    '/roles',
    {
      config: { access: { permission: 'users.read' } },
      schema: {
        tags: ['users'],
        summary: 'Roles con sus permisos y si el usuario actual puede asignarlos',
        response: { 200: z.array(RoleWithPermissionsDto) },
      },
    },
    async (request) => service.roles({ permissions: request.auth!.permissions }),
  );

  app.get(
    '/permissions',
    {
      config: { access: { permission: 'users.read' } },
      schema: {
        tags: ['users'],
        summary: 'Catálogo de permisos agrupado por módulo',
        response: { 200: z.array(PermissionGroupDto) },
      },
    },
    async () => service.permissions(),
  );
};
