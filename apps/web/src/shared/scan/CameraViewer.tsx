import { Flashlight, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import type { CameraScanner } from './cameraScanner';

export const CAMERA_ERROR_MESSAGE = 'No se pudo acceder a la cámara';

/** `true` si el navegador puede abrir la cámara: requiere HTTPS (o localhost) y `mediaDevices`. */
export function cameraAvailable(): boolean {
  return (
    window.isSecureContext === true && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export interface CameraViewerProps {
  scanner: CameraScanner;
  onCode: (text: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
  /** Aviso sobre la última lectura (p. ej. "Código no reconocido"). */
  message?: string | null;
}

/** Visor de pantalla completa con la cámara trasera; linterna solo si la pista la soporta. */
export function CameraViewer({ scanner, onCode, onClose, onError, message }: CameraViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const handleCode = useEffectEvent(onCode);
  const handleError = useEffectEvent(onError);
  const handleClose = useEffectEvent(onClose);

  useEffect(() => {
    let active = true;
    scanner.onCode((text) => {
      if (active) handleCode(text);
    });
    scanner.start(videoRef.current!).then(
      () => {
        if (active) setTorchAvailable(scanner.torchSupported());
      },
      () => {
        if (active) handleError(CAMERA_ERROR_MESSAGE);
      },
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      document.removeEventListener('keydown', onKeyDown);
      scanner.stop();
    };
  }, [scanner]);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await scanner.setTorch(next);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escanear con la cámara"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Cerrar cámara"
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          <X />
        </Button>
        {torchAvailable && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Linterna"
            aria-pressed={torchOn}
            className="text-white hover:bg-white/10 hover:text-white aria-pressed:bg-white/20"
            onClick={toggleTorch}
          >
            <Flashlight />
          </Button>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          className="max-h-full w-full max-w-3xl object-contain"
        />
      </div>
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
        <p>Apunta al código de barras o al QR</p>
        {message && (
          <p role="alert" className="mt-1 text-sm text-red-300">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
