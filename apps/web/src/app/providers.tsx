import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/shared/ui/sonner';

export function Providers({
  children,
  queryClient,
}: {
  children: ReactNode;
  /** Permite inyectar un cliente en los tests (p. ej. con `retry: false`). */
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
