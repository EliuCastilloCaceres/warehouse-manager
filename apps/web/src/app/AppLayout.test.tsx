import { QueryClient } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Providers } from './providers';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  });

  it('muestra los 6 módulos con su href (T9)', async () => {
    renderAt('/');

    const nav = await screen.findByRole('navigation', { name: 'Módulos' });
    const links = within(nav).getAllByRole('link');
    expect(
      links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
    ).toEqual([
      ['Almacén', '/warehouse'],
      ['Productos', '/products'],
      ['POS', '/pos'],
      ['Reportes', '/reports'],
      ['Usuarios', '/users'],
      ['Ajustes', '/settings'],
    ]);
  });

  it('en /pos muestra el placeholder sin llamar a la API (T10)', async () => {
    renderAt('/pos');

    expect(await screen.findByRole('heading', { name: 'POS' })).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
