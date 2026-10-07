import { createPrismaClient, type PrismaClient } from '../../../src/core/prisma-client.js';
import { testDatabaseUrl } from './env.js';

/** Cliente de Prisma contra la BD de pruebas. */
export function createTestClient(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** Vacía todas las tablas del esquema público (salvo el historial de migraciones). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
