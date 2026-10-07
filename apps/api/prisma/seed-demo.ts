// Entrada del seed de demo: solo exige DATABASE_URL y el seed base ya aplicado.
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/core/prisma-client.js';
import { loadRootEnv } from './load-env.js';
import { seedDemo } from './seed/demo.js';
import { formatSummary } from './seed/summary.js';

loadRootEnv(resolve(import.meta.dirname, '..'));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL (ver .env.example).');
  process.exit(1);
}

const prisma = createPrismaClient(databaseUrl);
try {
  const summary = await seedDemo(prisma);
  console.log(formatSummary('Seed de demo terminado.', summary));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
