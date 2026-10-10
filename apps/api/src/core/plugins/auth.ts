import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';

export interface AuthPluginOptions {
  secret: string;
  accessTtlMin: number;
}

/** JWT HS256 para el access token y las decoraciones `request.auth` / `request.branchId`. */
export const authPlugin = fp<AuthPluginOptions>(
  async (app, { secret, accessTtlMin }) => {
    await app.register(jwt, {
      secret,
      sign: { algorithm: 'HS256', expiresIn: `${accessTtlMin}m` },
      verify: { algorithms: ['HS256'] },
    });
    app.decorateRequest('auth', null);
    app.decorateRequest('branchId', null);
  },
  { name: 'auth' },
);
