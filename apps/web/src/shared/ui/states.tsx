import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function LoadingState({ message = 'Cargando…' }: { message?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <Loader2 aria-hidden className="size-6 animate-spin" />
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <Inbox aria-hidden className="size-6" />
      <p>{message}</p>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <AlertCircle aria-hidden className="size-6 text-destructive" />
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
