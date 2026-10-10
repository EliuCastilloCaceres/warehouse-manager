import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Providers } from '@/app/providers';
import { HealthStatus } from './HealthStatus';

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Providers queryClient={queryClient}>
      <HealthStatus />
    </Providers>,
  );
}

describe('HealthStatus', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('muestra "API: En línea" y la versión con un HealthDto válido (T7)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        version: '0.1.0',
        uptimeSeconds: 5,
        timestamp: '2026-10-01T18:00:00.000Z',
        database: 'ok',
      }),
    } as Response);

    renderStatus();

    expect(await screen.findByText('API: En línea')).toBeInTheDocument();
    expect(screen.getByText('versión 0.1.0')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/health');
  });

  it.each([
    ['rechazo de red', () => Promise.reject(new TypeError('Failed to fetch'))],
    [
      'HTTP 500',
      () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response),
    ],
  ])('muestra "API: Sin conexión" ante %s (T8)', async (_caso, impl) => {
    globalThis.fetch = jest.fn().mockImplementation(impl);

    renderStatus();

    expect(await screen.findByText('API: Sin conexión')).toBeInTheDocument();
  });
});
