import {
  paginated,
  PasswordInput,
  PasswordResetResultDto,
  UserCreatedDto,
  UserCreateInput,
  UserDetailDto,
  UserListItemDto,
  UserListQuery,
  UsernameSuggestionDto,
  UserUpdateInput,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Actor, UsersService } from './users.service.js';

const IdParams = z.object({ id: Uuid });
const READ = { access: { permission: 'users.read' } } as const;
const MANAGE = { access: { permission: 'users.manage' } } as const;

export function actorOf(request: FastifyRequest): Actor {
  const auth = request.auth!;
  return {
    userId: auth.userId,
    permissions: auth.permissions,
    branchIds: auth.branchIds,
    ip: request.ip ?? null,
  };
}

/** `/users` (spec F4 §6). Ninguna ruta depende de la sucursal. */
export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new UsersService(app);

  app.get(
    '/',
    {
      config: READ,
      schema: {
        tags: ['users'],
        summary: 'Listar usuarios',
        querystring: UserListQuery,
        response: { 200: paginated(UserListItemDto) },
      },
    },
    async (request) => service.list(request.query),
  );

  app.get(
    '/suggest-username',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Sugerir un nombre de usuario libre',
        querystring: z.object({ fullName: z.string().trim().min(1).max(100) }),
        response: { 200: UsernameSuggestionDto },
      },
    },
    async (request) => service.suggestUsername(request.query.fullName),
  );

  app.get(
    '/:id',
    {
      config: READ,
      schema: {
        tags: ['users'],
        summary: 'Detalle de un usuario',
        params: IdParams,
        response: { 200: UserDetailDto },
      },
    },
    async (request) => service.get(request.params.id),
  );

  app.post(
    '/',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Crear un usuario',
        body: UserCreateInput,
        response: { 201: UserCreatedDto },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(actorOf(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Editar un usuario',
        params: IdParams,
        body: UserUpdateInput,
        response: { 200: UserDetailDto },
      },
    },
    async (request) => service.update(actorOf(request), request.params.id, request.body),
  );

  app.post(
    '/:id/deactivate',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Desactivar un usuario (cierra sus sesiones)',
        params: IdParams,
        response: { 200: UserDetailDto },
      },
    },
    async (request) => service.deactivate(actorOf(request), request.params.id),
  );

  app.post(
    '/:id/reactivate',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Reactivar un usuario',
        params: IdParams,
        response: { 200: UserDetailDto },
      },
    },
    async (request) => service.reactivate(actorOf(request), request.params.id),
  );

  app.post(
    '/:id/reset-password',
    {
      config: MANAGE,
      schema: {
        tags: ['users'],
        summary: 'Restablecer la contraseña (cierra sus sesiones)',
        params: IdParams,
        body: PasswordInput,
        response: { 200: PasswordResetResultDto },
      },
    },
    async (request) => service.resetPassword(actorOf(request), request.params.id, request.body),
  );
};
