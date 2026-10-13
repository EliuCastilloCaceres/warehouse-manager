import type { PermissionCode } from '@warehouse-manager/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionMatrix, type PermissionMatrixProps } from './PermissionMatrix';
import { PERMISSION_GROUPS, permsOf } from './testing';

function setup(props: Partial<PermissionMatrixProps> = {}) {
  const onChange = jest.fn<void, [PermissionCode[]]>();
  render(
    <PermissionMatrix
      groups={PERMISSION_GROUPS}
      rolePermissions={permsOf('SELLER')}
      value={['inventory.adjust']}
      onChange={onChange}
      actorPermissions={permsOf('MANAGER')}
      readOnly={false}
      {...props}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

describe('PermissionMatrix (T28)', () => {
  it('agrupa por módulo con las etiquetas en español', () => {
    setup();
    const legends = screen.getAllByRole('group').map((group) => group.querySelector('legend'));
    expect(legends.map((legend) => legend?.textContent)).toEqual([
      'Usuarios',
      'Productos',
      'Almacén',
      'Inventario',
      'POS',
      'Reportes',
      'Ajustes',
    ]);
  });

  it('los permisos del rol aparecen marcados y bloqueados ("Del rol")', () => {
    setup();
    const sell = box('Vender');
    expect(sell).toBeChecked();
    expect(sell).toBeDisabled();
    expect(sell.closest('label')).toHaveTextContent('Del rol');
  });

  it('los extras se alternan', async () => {
    const { onChange, user } = setup();
    expect(box('Ajustar inventario')).toBeChecked();

    await user.click(box('Ajustar inventario'));
    expect(onChange).toHaveBeenLastCalledWith([]);

    await user.click(box('Aplicar descuentos'));
    expect(onChange).toHaveBeenLastCalledWith(['inventory.adjust', 'pos.discount']);
  });

  it('en solo lectura nada es editable', () => {
    setup({ readOnly: true });
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(box('Ajustar inventario')).toBeChecked();
  });

  it('los permisos que el actor no tiene están deshabilitados', () => {
    setup();
    const grant = box('Asignar permisos a usuarios');
    expect(grant).toBeDisabled();
    expect(grant.closest('label')).toHaveTextContent('No lo tienes');
    expect(box('Aplicar descuentos')).toBeEnabled();
  });
});
