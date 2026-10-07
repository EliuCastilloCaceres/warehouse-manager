// Entrada del seed base: parseSeedEnv → createPrismaClient → seedBase.
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/core/prisma-client.js';
import { seedBase } from './seed/base.js';
import { parseSeedEnv } from './seed/env.js';
import { loadRootEnv } from './load-env.js';
import { formatSummary } from './seed/summary.js';

loadRootEnv(resolve(import.meta.dirname, '..'));

let env;
try {
  env = parseSeedEnv(process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const summary = await seedBase(prisma, {
    ownerPassword: env.OWNER_INITIAL_PASSWORD,
    adminPassword: env.ADMIN_INITIAL_PASSWORD,
  });
  console.log(formatSummary('Seed base terminado.', summary));
} catch (error) {
  console.error('El seed base falló; no se guardó ningún cambio.\n', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
