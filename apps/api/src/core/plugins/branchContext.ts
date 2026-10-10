import { Uuid } from '@warehouse-manager/shared';
import fp from 'fastify-plugin';
import { DomainError, validationError } from '../errors.js';

/**
 * Resuelve `request.branchId` en las rutas `branchScoped` (spec F2 §2):
 * header `X-Branch-Id` permitido → sucursal por defecto → la única sucursal → 400 BRANCH_REQUIRED.
 */
export const branchContextPlugin = fp(
  async (app) => {
    app.addHook('preHandler', async (request) => {
      if (!request.routeOptions.config.branchScoped) return;
      const auth = request.auth;
      if (!auth) throw new DomainError('UNAUTHENTICATED');

      const header = request.headers['x-branch-id'];
      if (header !== undefined) {
        const value = Array.isArray(header) ? header[0] : header;
        if (!Uuid.safeParse(value).success) {
          throw validationError('x-branch-id', 'El header X-Branch-Id debe ser un UUID');
        }
        if (!auth.branchIds.includes(value!)) throw new DomainError('BRANCH_FORBIDDEN');
        request.branchId = value!;
        return;
      }

      if (auth.defaultBranchId && auth.branchIds.includes(auth.defaultBranchId)) {
        request.branchId = auth.defaultBranchId;
      } else if (auth.branchIds.length === 1) {
        request.branchId = auth.branchIds[0]!;
      } else {
        throw new DomainError('BRANCH_REQUIRED');
      }
    });
  },
  { name: 'branch-context', dependencies: ['access'] },
);
