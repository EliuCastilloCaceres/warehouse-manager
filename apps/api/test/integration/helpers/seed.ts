import { seedBase } from '../../../prisma/seed/base.js';
import type { PrismaClient } from '../../../src/core/prisma-client.js';
import { truncateAll } from './db.js';

export const OWNER_PASSWORD = 'clave-owner-prueba';
export const ADMIN_PASSWORD = 'clave-admin-prueba';

/** BD vacía + seed base (permisos, roles, S1/S2, owner y admin). */
export async function resetWithSeed(prisma: PrismaClient): Promise<void> {
  await truncateAll(prisma);
  await seedBase(prisma, { ownerPassword: OWNER_PASSWORD, adminPassword: ADMIN_PASSWORD });
}
