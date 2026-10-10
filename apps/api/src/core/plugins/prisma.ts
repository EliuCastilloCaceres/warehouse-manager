import fp from 'fastify-plugin';
import type { PrismaClient } from '../../generated/prisma/client.js';

export interface PrismaPluginOptions {
  prisma: PrismaClient;
  /** Si el cliente lo creó `buildApp`, se desconecta al cerrar la app. */
  owned: boolean;
}

export const prismaPlugin = fp<PrismaPluginOptions>(
  async (app, { prisma, owned }) => {
    app.decorate('prisma', prisma);
    if (owned) {
      app.addHook('onClose', async () => {
        await prisma.$disconnect();
      });
    }
  },
  { name: 'prisma' },
);
