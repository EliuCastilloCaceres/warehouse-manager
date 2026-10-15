import type { SystemRoleCode } from '@warehouse-manager/shared';
import { screen, within } from '@testing-library/react';
import { mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';
import { makeTree, ok, warehouseRoutes, treeKey } from './testing';

const startWarehouse = (...args: Parameters<typeof warehouseRoutes>) =>
  mockFetch(warehouseRoutes(...args));

const ALL = [
  'Mapa',
  'Buscar',
  'Ubicar',
  'Reubicar',
  'Staging',
  'Ajustar',
  'Kardex',
  'Configurar',
  'Etiquetas',
];

describe('WarehouseHomePage (T28)', () => {
  it.each<[string, SystemRoleCode, string[]]>([
    ['Vendedor', 'SELLER', ['Mapa', 'Buscar', 'Reubicar']],
    ['Almacenista', 'WAREHOUSE_CLERK', ALL.filter((label) => label !== 'Ajustar')],
    ['Gerente', 'MANAGER', ALL],
  ])('%s ve sus accesos', async (_rol, role, expected) => {
    startWarehouse({ [treeKey()]: ok(makeTree()) }, { role });
    renderApp('/warehouse');
    const nav = await screen.findByRole('navigation', { name: 'Almacén' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent?.replace(/\d+ pzas$/, ''))).toEqual(expected);
  });

  it('Staging muestra las unidades pendientes de ubicar', async () => {
    startWarehouse({ [treeKey()]: ok(makeTree()) });
    renderApp('/warehouse');
    const staging = await screen.findByRole('link', { name: /Staging/ });
    expect(await within(staging).findByText('12 pzas')).toBeInTheDocument();
    expect(staging).toHaveAttribute('href', '/warehouse/staging');
    expect(screen.getByRole('link', { name: 'Ajustar' })).toHaveAttribute(
      'href',
      '/warehouse/search?mode=adjust',
    );
  });

  it('un acceso lleva a su pantalla', async () => {
    startWarehouse({ [treeKey()]: ok(makeTree()) }, { role: 'SELLER' });
    const app = renderApp('/warehouse');
    await app.user.click(await screen.findByRole('link', { name: 'Mapa' }));
    expect(app.location()).toBe('/warehouse/map');
  });
});
