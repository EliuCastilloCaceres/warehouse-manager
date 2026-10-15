import type { ContentRowDto, StockFilter } from '@warehouse-manager/shared';
import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { Can } from '@/features/auth/guards';
import { errorMessage } from '@/shared/api/errors';
import { CapacityBar } from '@/shared/ui/CapacityBar';
import { Button } from '@/shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states';
import { type AdjustTarget, AdjustDialog } from './AdjustDialog';
import { CONTENT_PAGE_SIZE, type NodeKind, useNodeContent } from './api';
import { ColorDot, StockBadges } from './components';

function Thumb({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="size-12 shrink-0 rounded object-cover" />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted">
      <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
    </span>
  );
}

/**
 * Contenido de una zona, un contenedor o un rack: miniatura, SKU, variante, cantidades y estado.
 * En un rack, con `inventory.adjust`, cada fila ofrece "Ajustar".
 */
export function RackContent({
  node,
  status,
}: {
  node: { kind: NodeKind; id: string };
  status?: StockFilter;
}) {
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<AdjustTarget | null>(null);
  const content = useNodeContent(node, status, page);

  if (content.error) {
    return (
      <ErrorState message={errorMessage(content.error)} onRetry={() => void content.refetch()} />
    );
  }
  if (!content.data) return <LoadingState />;
  const { node: info, items, total } = content.data;
  const pages = Math.max(1, Math.ceil(total / CONTENT_PAGE_SIZE));
  const adjust = (row: ContentRowDto) =>
    setAdjusting({
      variant: { id: row.variantId, sku: row.sku, label: row.variantLabel },
      rack: { id: info.id, locationCode: info.code },
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ColorDot hex={info.colorHex} />
        <span className="font-mono text-lg font-semibold">{info.code}</span>
        {info.name && <span className="text-muted-foreground">{info.name}</span>}
      </div>
      <CapacityBar
        label={`Ocupación de ${info.code}`}
        used={info.occupancy.occupied}
        capacity={info.occupancy.capacity}
        unlimited={info.isStaging}
      />

      {items.length === 0 ? (
        <EmptyState message="No hay productos aquí." />
      ) : (
        <ul
          aria-label={`Contenido de ${info.code}`}
          className="flex flex-col divide-y rounded-md border"
        >
          {items.map((row) => (
            <li key={row.variantId} className="flex items-center gap-3 p-2">
              <Thumb url={row.thumbUrl} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-mono text-sm">{row.sku}</span>
                <span className="truncate text-sm">
                  {row.productName}
                  {row.variantLabel && ` · ${row.variantLabel}`}
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.quantity} pzas
                  {row.reservedQty > 0 && ` (${row.reservedQty} en piso)`}
                </span>
                <StockBadges stock={row.stock} />
              </div>
              {node.kind === 'rack' && (
                <Can perm="inventory.adjust">
                  <Button variant="outline" onClick={() => adjust(row)}>
                    Ajustar
                  </Button>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Siguiente
          </Button>
        </nav>
      )}
      <AdjustDialog target={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}
