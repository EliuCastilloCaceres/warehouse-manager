import { type ReactNode, useEffect, useState } from 'react';
import { PrintLayout, usePrint } from '@/shared/print/PrintLayout';
import type { TicketWidth } from '@/shared/ticket/TicketHeader';

/**
 * Imprime un contenido de ticket: lo monta en `PrintLayout` (`ticket-80` o `ticket-58`) solo
 * mientras se imprime, llama a `window.print` y lo desmonta con `afterprint` (como F5).
 */
export function useTicketPrint() {
  const [job, setJob] = useState<{ content: ReactNode; width: TicketWidth } | null>(null);
  const print = usePrint();

  useEffect(() => {
    if (!job) return;
    const done = () => setJob(null);
    window.addEventListener('afterprint', done);
    print();
    return () => window.removeEventListener('afterprint', done);
  }, [job, print]);

  return {
    printTicket: (content: ReactNode, width: TicketWidth) => setJob({ content, width }),
    printing: job !== null,
    printElement: job && (
      <PrintLayout size={job.width === 80 ? 'ticket-80' : 'ticket-58'}>{job.content}</PrintLayout>
    ),
  };
}
