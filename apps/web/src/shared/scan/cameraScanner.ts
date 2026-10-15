import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

/**
 * Adaptador de `@zxing/browser`. Es lo único que toca la cámara: queda fuera de la cobertura y se
 * verifica a mano (spec F3 CA7). Los tests simulan este módulo; su propio test cubre solo las
 * sesiones, con `@zxing/browser` simulado.
 */
export interface CameraScanner {
  /** Abre la cámara trasera en `video` y empieza a leer. Rechaza si no hay permiso o cámara. */
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  onCode(listener: (text: string) => void): void;
  torchSupported(): boolean;
  setTorch(on: boolean): Promise<void>;
}

const FORMATS = [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.QR_CODE];

export function createCameraScanner(): CameraScanner {
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]);
  const reader = new BrowserMultiFormatReader(hints);
  let controls: IScannerControls | null = null;
  // Cada `start` abre una sesión y `stop` la cierra. Una sesión vieja (StrictMode monta, desmonta
  // y vuelve a montar el visor; o se cierra y reabre mientras arranca) no entrega lecturas: su
  // bucle seguiría decodificando el último cuadro, p. ej. el QR del origen al buscar el destino.
  let session = 0;
  // Una sesión a la vez: la siguiente espera a que la anterior termine de arrancar (o de soltar la
  // cámara), para que dos no compartan el mismo `<video>`.
  let starting: Promise<unknown> = Promise.resolve();
  let listener: (text: string) => void = () => {};

  return {
    start(video) {
      const current = ++session;
      const run = starting.then(async () => {
        if (current !== session) return;
        const started = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: 'environment' } },
          video,
          (result) => {
            if (result && current === session) listener(result.getText());
          },
        );
        // Si se cerró el visor mientras se pedía el permiso, se libera la cámara de inmediato.
        if (current === session) controls = started;
        else started.stop();
      });
      starting = run.catch(() => {});
      return run;
    },
    stop() {
      session++;
      controls?.stop();
      controls = null;
    },
    onCode(next) {
      listener = next;
    },
    torchSupported: () => typeof controls?.switchTorch === 'function',
    async setTorch(on) {
      await controls?.switchTorch?.(on);
    },
  };
}
