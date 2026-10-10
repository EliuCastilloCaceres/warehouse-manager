import { PERMISSIONS, SYSTEM_ROLES } from '@warehouse-manager/shared';
import { effectivePermissions } from './permissions.js';

describe('effectivePermissions (T4)', () => {
  it('une rol y extras, sin duplicados y ordenados', () => {
    expect(
      effectivePermissions(['pos.sell', 'products.read'], ['pos.discount', 'pos.sell']),
    ).toEqual(['pos.discount', 'pos.sell', 'products.read']);
  });

  it('descarta códigos ajenos al catálogo', () => {
    expect(effectivePermissions(['pos.sell', 'legacy.thing'], ['pos.fly'])).toEqual(['pos.sell']);
  });

  it.each(SYSTEM_ROLES.map((r) => [r.code, r] as const))(
    'respeta el rol del sistema %s',
    (_code, role) => {
      const perms = effectivePermissions(role.permissions);
      expect(perms).toEqual([...role.permissions].sort());
    },
  );

  it('el Propietario y el Administrador tienen todo el catálogo', () => {
    const all = PERMISSIONS.map((p) => p.code).sort();
    for (const code of ['OWNER', 'ADMIN']) {
      const role = SYSTEM_ROLES.find((r) => r.code === code)!;
      expect(effectivePermissions(role.permissions)).toEqual(all);
    }
  });
});
