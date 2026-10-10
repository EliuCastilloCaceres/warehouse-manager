import { AuthSessionDto, ChangePasswordInput, LoginInput, MeDto } from '@warehouse-manager/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError } from '../../core/errors.js';
import type { RequestMeta } from './auth.service.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './tokens.js';

const ONE_MINUTE = '1 minute';

function meta(request: FastifyRequest): RequestMeta {
  return { ip: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.authService;
  const cookieOptions = {
    httpOnly: true,
    secure: app.config.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
  };
  const setRefreshCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(REFRESH_COOKIE, token, {
      ...cookieOptions,
      maxAge: app.config.REFRESH_TTL_DAYS * 86_400,
    });
  const clearRefreshCookie = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);

  app.post(
    '/login',
    {
      config: {
        access: 'public',
        // preHandler: el body ya viene validado y con el usuario normalizado.
        rateLimit: {
          max: 5,
          timeWindow: ONE_MINUTE,
          hook: 'preHandler',
          keyGenerator: (request) =>
            `${request.ip}|${(request.body as { username?: string } | undefined)?.username ?? ''}`,
        },
      },
      schema: {
        tags: ['auth'],
        summary: 'Iniciar sesión',
        body: LoginInput,
        response: { 200: AuthSessionDto },
      },
    },
    async (request, reply) => {
      const { session, refreshToken } = await service.login(request.body, meta(request));
      setRefreshCookie(reply, refreshToken);
      return session;
    },
  );

  app.post(
    '/refresh',
    {
      config: {
        access: 'public',
        checkOrigin: true,
        rateLimit: { max: 30, timeWindow: ONE_MINUTE },
      },
      schema: {
        tags: ['auth'],
        summary: 'Renovar el access token con la cookie de refresh',
        response: { 200: AuthSessionDto },
      },
    },
    async (request, reply) => {
      try {
        const { session, refreshToken } = await service.refresh(
          request.cookies[REFRESH_COOKIE],
          meta(request),
        );
        setRefreshCookie(reply, refreshToken);
        return session;
      } catch (error) {
        if (error instanceof DomainError) clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.post(
    '/logout',
    {
      config: { access: 'public', checkOrigin: true },
      schema: {
        tags: ['auth'],
        summary: 'Cerrar la sesión actual',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.logout(request.cookies[REFRESH_COOKIE]);
      clearRefreshCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      config: { access: 'authenticated', allowDuringPasswordChange: true },
      schema: { tags: ['auth'], summary: 'Usuario actual', response: { 200: MeDto } },
    },
    async (request) => service.me(request.auth!.userId),
  );

  app.post(
    '/change-password',
    {
      config: {
        access: 'authenticated',
        allowDuringPasswordChange: true,
        checkOrigin: true,
        rateLimit: {
          max: 5,
          timeWindow: ONE_MINUTE,
          hook: 'preHandler',
          keyGenerator: (request) => request.auth?.userId ?? request.ip,
        },
      },
      schema: {
        tags: ['auth'],
        summary: 'Cambiar la contraseña (cierra las demás sesiones)',
        body: ChangePasswordInput,
        response: { 200: AuthSessionDto },
      },
    },
    async (request, reply) => {
      const { session, refreshToken } = await service.changePassword(
        request.auth!.userId,
        request.body,
        meta(request),
      );
      setRefreshCookie(reply, refreshToken);
      return session;
    },
  );
};
