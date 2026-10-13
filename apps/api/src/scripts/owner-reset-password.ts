// `pnpm owner:reset-password`: nueva contraseña para el Propietario (spec F4 §3).
// Solo necesita DATABASE_URL; en desarrollo la toma del .env de la raíz.
import { createPrismaClient } from '../core/prisma-client.js';
import { resetOwnerPassword } from '../modules/users/ownerReset.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const prisma = createPrismaClient(databaseUrl);
try {
  const password = await resetOwnerPassword(prisma);
  console.log(
    [
      'Contraseña del Propietario restablecida y sesiones cerradas.',
      `Contraseña temporal: ${password}`,
      'No se volverá a mostrar; se pedirá cambiarla al iniciar sesión.',
    ].join('\n'),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
