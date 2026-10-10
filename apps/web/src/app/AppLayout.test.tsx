import type { SystemRoleCode } from '@warehouse-manager/shared';
import { screen, within } from '@testing-library/react';
import { makeSession } from '@/test/fixtures';
import { jsonResponse, mockFetch } from '@/test/http';
import { renderApp } from '@/test/renderApp';

const ALL = [
  ['Almacén', '/warehouse'],
  ['Productos', '/products'],
  ['POS', '/pos'],
  ['Reportes', '/reports'],
  ['Usuarios', '/users'],
  ['Ajustes', '/settings'],
];

describe('AppLayout', () => {
  // Adapta T9 de F0: el menú se filtra por los permisos del rol.
  it.each<[SystemRoleCode, string[][]]>([
    ['OWNER', ALL],
    ['ADMIN', ALL],
    ['MANAGER', ALL],
    ['SELLER', ALL.slice(0, 4)],
    ['WAREHOUSE_CLERK', ALL.slice(0, 2)],
  ])('%s ve sus módulos con el href correcto (T17)', async (role, expected) => {
    mockFetch({ 'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ role })) });
    renderApp('/pos-no-existe');

    const nav = await screen.findByRole('navigation', { name: 'Módulos' });
    const links = within(nav).getAllByRole('link');
    expect(
      links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
    ).toEqual(expected);
  });

  // Adapta T10 de F0.
  it('en /pos con pos.sell muestra el placeholder sin más fetch que el refresh (T18)', async () => {
    const fetchMock = mockFetch({
      'POST /api/v1/auth/refresh': () => jsonResponse(200, makeSession({ role: 'SELLER' })),
    });
    renderApp('/pos');

    expect(await screen.findByRole('heading', { name: 'POS' })).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
