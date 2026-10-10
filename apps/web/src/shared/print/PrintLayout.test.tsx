import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { PRINT_ROOT_ID, PrintLayout, type PrintSize, usePrint } from './PrintLayout';

const printRoot = () => document.getElementById(PRINT_ROOT_ID)!;

afterEach(() => {
  document.getElementById(PRINT_ROOT_ID)?.remove();
});

describe('PrintLayout (T30)', () => {
  it.each<[PrintSize, string, string | undefined]>([
    ['label-50x25', '50mm 25mm', '50mm'],
    ['label-4x6', '4in 6in', '4in'],
    ['a4', 'A4', undefined],
    ['letter', 'letter', undefined],
    ['ticket-80', '80mm auto', '72mm'],
    ['ticket-58', '58mm auto', '48mm'],
  ])('%s → @page { size: %s }, contenido en #print-root de ancho %s', (size, page, width) => {
    render(
      <div id="app">
        <PrintLayout size={size}>
          <p>contenido</p>
        </PrintLayout>
      </div>,
    );

    const content = screen.getByText('contenido');
    expect(printRoot()).toContainElement(content);
    expect(document.getElementById('app')).not.toContainElement(content);
    expect(printRoot().querySelector('style')?.textContent).toBe(
      `@page { size: ${page}; margin: 0; }`,
    );

    const box = printRoot().querySelector<HTMLElement>(`[data-print-size="${size}"]`)!;
    expect(box.style.width).toBe(width ?? '');
  });

  it('las etiquetas recortan el contenido a su alto', () => {
    render(
      <PrintLayout size="label-50x25">
        <p>etiqueta</p>
      </PrintLayout>,
    );
    const box = printRoot().querySelector<HTMLElement>('[data-print-size]')!;
    expect(box.style.height).toBe('25mm');
    expect(box.style.overflow).toBe('hidden');
  });

  it('reutiliza un #print-root existente; al desmontar solo quita su contenido', () => {
    const { unmount } = render(
      <PrintLayout size="a4">
        <p>hoja</p>
      </PrintLayout>,
    );
    render(
      <PrintLayout size="ticket-80">
        <p>ticket</p>
      </PrintLayout>,
    );
    expect(document.querySelectorAll(`#${PRINT_ROOT_ID}`)).toHaveLength(1);

    unmount();
    expect(screen.queryByText('hoja')).not.toBeInTheDocument();
    expect(screen.getByText('ticket')).toBeInTheDocument();
  });
});

describe('usePrint (T30)', () => {
  it('llama a window.print después del render', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => usePrint());
      result.current();
      expect(print).not.toHaveBeenCalled();
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    } finally {
      print.mockRestore();
    }
  });
});
