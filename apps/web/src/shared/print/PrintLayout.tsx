import { type ReactNode, useCallback } from 'react';
import { createPortal } from 'react-dom';

export type PrintSize = 'label-50x25' | 'label-4x6' | 'a4' | 'letter' | 'ticket-80' | 'ticket-58';

interface PrintSizeSpec {
  /** Valor de `@page { size }`. */
  page: string;
  /** Medidas del contenido; en tickets es el ancho imprimible de la térmica. */
  width?: string;
  height?: string;
}

/** Tamaños de plan §7.2. Los tickets miden 72 mm (papel de 80) y 48 mm (papel de 58) de ancho. */
export const PRINT_SIZES: Record<PrintSize, PrintSizeSpec> = {
  'label-50x25': { page: '50mm 25mm', width: '50mm', height: '25mm' },
  'label-4x6': { page: '4in 6in', width: '4in', height: '6in' },
  a4: { page: 'A4' },
  letter: { page: 'letter' },
  'ticket-80': { page: '80mm auto', width: '72mm' },
  'ticket-58': { page: '58mm auto', width: '48mm' },
};

export const PRINT_ROOT_ID = 'print-root';

function printRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    document.body.append(root);
  }
  return root;
}

/**
 * Monta `children` en `#print-root` con su `@page`. En pantalla `#print-root` no se ve, y al
 * imprimir solo se ve él (estilos en `index.css`).
 */
export function PrintLayout({ size, children }: { size: PrintSize; children: ReactNode }) {
  const spec = PRINT_SIZES[size];
  return createPortal(
    <>
      <style>{`@page { size: ${spec.page}; margin: 0; }`}</style>
      <div
        data-print-size={size}
        style={{
          width: spec.width,
          height: spec.height,
          overflow: spec.height ? 'hidden' : undefined,
        }}
      >
        {children}
      </div>
    </>,
    printRoot(),
  );
}

/** Abre el diálogo de impresión después de que React pinte el contenido de `PrintLayout`. */
export function usePrint(): () => void {
  return useCallback(() => {
    requestAnimationFrame(() => window.print());
  }, []);
}
