import { useNavigate } from 'react-router';
import { errorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states';
import { useNodeContent, useWarehouse, useWarehouseTree } from './api';
import { BackLink } from './WarehouseHomePage';

/** `/warehouse/staging`: lo pendiente de ubicar; "Ubicar" abre "producto primero" desde staging. */
export function StagingPage() {
  const navigate = useNavigate();
  const { warehouse } = useWarehouse();
  const tree = useWarehouseTree(warehouse?.id);
  const stagingId = tree.data?.staging.rackId;
  const content = useNodeContent(stagingId ? { kind: 'rack', id: stagingId } : null);

  const error = tree.error ?? content.error;
  return (
    <section className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-xl font-semibold">Staging</h1>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void content.refetch()} />
      ) : !content.data ? (
        <LoadingState />
      ) : content.data.items.length === 0 ? (
        <EmptyState message="No hay productos pendientes de ubicar." />
      ) : (
        <ul aria-label="Pendientes de ubicar" className="flex flex-col divide-y rounded-md border">
          {content.data.items.map((row) => (
            <li key={row.variantId} className="flex min-h-16 items-center gap-3 p-3">
              <span className="flex flex-1 flex-col">
                <span className="font-mono text-sm">{row.sku}</span>
                <span className="text-sm">
                  {row.productName}
                  {row.variantLabel && ` · ${row.variantLabel}`}
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.quantity} pzas
                  {row.reservedQty > 0 && ` (${row.reservedQty} en piso)`}
                </span>
              </span>
              <Button
                className="h-14"
                aria-label={`Ubicar ${row.sku}`}
                disabled={row.available === 0}
                onClick={() =>
                  navigate(`/warehouse/putaway?${new URLSearchParams({ sku: row.sku })}`)
                }
              >
                Ubicar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
