import { AuditService } from '../../core/audit/audit.service.js';
import { generateReadablePassword, hashPassword } from '../../core/password.js';
import type { PrismaClient } from '../../core/prisma-client.js';
import { revokeAllForUser } from '../auth/auth.repository.js';
import { findOwnerId, setPassword } from './users.repository.js';

export const NO_OWNER_MESSAGE = 'No existe un Propietario. Ejecuta primero `pnpm db:seed`.';

/**
 * Contraseña olvidada del Propietario (spec F4 §3): genera una nueva, obliga a cambiarla,
 * cierra sus sesiones y lo audita, todo en una transacción. Devuelve la contraseña en claro.
 */
export async function resetOwnerPassword(prisma: PrismaClient): Promise<string> {
  const ownerId = await findOwnerId(prisma);
  if (!ownerId) throw new Error(NO_OWNER_MESSAGE);
  const password = generateReadablePassword();
  const passwordHash = await hashPassword(password);
  const audit = new AuditService(prisma);
  await prisma.$transaction(async (tx) => {
    await setPassword(tx, ownerId, passwordHash);
    await revokeAllForUser(tx, ownerId, new Date());
    await audit.record(
      { userId: null, action: 'user.owner_password_reset', entity: 'User', entityId: ownerId },
      tx,
    );
  });
  return password;
}
