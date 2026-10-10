/** Un lector HID "teclea" el código en ráfaga y termina con Enter (spec F3 §4). */
export const HID_MIN_LENGTH = 4;
export const HID_MAX_INTERVAL_MS = 35;

export interface HidDetector {
  /** Procesa una tecla con su instante (ms); devuelve el código si la tecla cierra una ráfaga. */
  handleKey(key: string, timestamp: number): string | null;
  reset(): void;
}

/** Detector puro: una ráfaga de ≥ 4 caracteres con intervalos ≤ 35 ms, terminada en Enter. */
export function createHidDetector(): HidDetector {
  let buffer = '';
  let last = Number.NEGATIVE_INFINITY;

  const reset = () => {
    buffer = '';
    last = Number.NEGATIVE_INFINITY;
  };

  return {
    handleKey(key, timestamp) {
      const inBurst = timestamp - last <= HID_MAX_INTERVAL_MS;
      if (key === 'Enter') {
        const code = inBurst && buffer.length >= HID_MIN_LENGTH ? buffer : null;
        reset();
        return code;
      }
      // Shift, Alt y demás teclas sin carácter no rompen la ráfaga.
      if (key.length !== 1) return null;
      buffer = inBurst ? buffer + key : key;
      last = timestamp;
      return null;
    },
    reset,
  };
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'file',
  'image',
  'range',
  'color',
]);

/** ¿El elemento recibe texto? (input de texto, textarea, select o contenteditable). */
export function isEditableElement(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(element.type);
}

/**
 * Escucha `keydown` en `document` y llama a `onScan` con cada ráfaga del lector, solo cuando el
 * foco está fuera de campos editables (si no, la ráfaga la recibe ese campo). Devuelve la función
 * para dejar de escuchar.
 */
export function listenHid(
  onScan: (code: string) => void,
  now: () => number = () => performance.now(),
) {
  const detector = createHidDetector();
  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableElement(event.target)) {
      detector.reset();
      return;
    }
    const code = detector.handleKey(event.key, now());
    if (code) {
      // Que el Enter del lector no active el botón que tenga el foco.
      event.preventDefault();
      onScan(code);
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
