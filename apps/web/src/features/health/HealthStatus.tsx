import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchHealth } from './fetchHealth';

export function HealthStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  const [text, dot] = isPending
    ? ['Comprobando API…', 'bg-gray-400']
    : isError
      ? ['API: Sin conexión', 'bg-red-500']
      : ['API: En línea', 'bg-green-500'];

  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border p-3">
      <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', dot)} />
      <div>
        <p>{text}</p>
        {data && !isError && (
          <p className="text-sm text-muted-foreground">versión {data.version}</p>
        )}
      </div>
    </div>
  );
}
