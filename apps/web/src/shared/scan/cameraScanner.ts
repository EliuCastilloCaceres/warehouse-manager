import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

/**
 * Adaptador de `@zxing/browser`. Es lo único que toca la cámara: queda fuera de la cobertura y se
 * verifica a mano (spec F3 CA7). Los tests simulan este módulo.
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
  let stopped = false;
  let listener: (text: string) => void = () => {};

  return {
    async start(video) {
      stopped = false;
      const started = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: 'environment' } },
        video,
        (result) => {
          if (result) listener(result.getText());
        },
      );
      // Si se cerró el visor mientras se pedía el permiso, se libera la cámara de inmediato.
      if (stopped) started.stop();
      else controls = started;
    },
    stop() {
      stopped = true;
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
