import { PERMISSION_MODULES, PERMISSIONS, SYSTEM_ROLES } from './index.js';

describe('permisos (T10)', () => {
  const codes = PERMISSIONS.map((p) => p.code);

  it('hay 25 códigos únicos con formato válido y módulo coherente', () => {
    expect(codes).toHaveLength(25);
    expect(new Set(codes).size).toBe(25);
    for (const { code, module } of PERMISSIONS) {
      expect(code).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      expect(code.split('.')[0]).toBe(module);
      expect(PERMISSION_MODULES).toContain(module);
    }
  });

  it('los roles del sistema tienen exactamente los permisos de la spec', () => {
    const byCode = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.code, [...r.permissions].sort()]));
    expect(Object.keys(byCode)).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'SELLER', 'WAREHOUSE_CLERK']);
    expect(SYSTEM_ROLES.map((r) => r.permissions.length)).toEqual([25, 25, 24, 8, 8]);
    expect(byCode.OWNER).toEqual([...codes].sort());
    expect(byCode.ADMIN).toEqual([...codes].sort());
    expect(byCode.MANAGER).toEqual(codes.filter((c) => c !== 'users.permissions').sort());
    expect(byCode.SELLER).toEqual(
      [
        'products.read',
        'warehouse.read',
        'pos.session.open',
        'pos.session.close',
        'pos.sell',
        'inventory.relocate',
        'inventory.other_branches.read',
        'reports.sales',
      ].sort(),
    );
    expect(byCode.WAREHOUSE_CLERK).toEqual(
      [
        'products.read',
        'products.labels',
        'warehouse.read',
        'warehouse.manage',
        'warehouse.labels',
        'inventory.putaway',
        'inventory.relocate',
        'inventory.movements.read',
      ].sort(),
    );
    for (const role of SYSTEM_ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const code of role.permissions) expect(codes).toContain(code);
    }
  });
});
