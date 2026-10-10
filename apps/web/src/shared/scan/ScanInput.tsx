import { classifyScan, type ScanResult } from '@warehouse-manager/shared';
import { Camera } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { type CameraScanner, createCameraScanner } from './cameraScanner';
import { CameraViewer, cameraAvailable } from './CameraViewer';
import { scanFeedback, primeScanFeedback } from './feedback';
import { createHidDetector, listenHid } from './hidDetector';

export const INVALID_CODE_MESSAGE = 'Código no reconocido';
export const CAMERA_REQUIRES_HTTPS_MESSAGE = 'La cámara requiere HTTPS';
/** El mismo código leído por la cámara dentro de este lapso se ignora. */
export const CAMERA_DEBOUNCE_MS = 1500;

export type ValidScan = Exclude<ScanResult, { kind: 'invalid' }>;
export type ScanSource = 'camera' | 'hid' | 'manual';

export interface ScanInputProps {
  /** Lecturas válidas (`location`, `product` o `promo`); las `invalid` muestran "Código no reconocido". */
  onScan: (result: ValidScan, meta: { source: ScanSource }) => void;
  /** Captura también el lector HID con el foco fuera de campos editables. */
  captureHid?: boolean;
  /** Con `false` (por defecto) el visor de cámara se cierra tras la primera lectura. */
  continuous?: boolean;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Campo de escaneo: cámara, lector HID y tecleo manual, todos clasificados con `classifyScan`. */
export function ScanInput({
  onScan,
  captureHid,
  continuous = false,
  label = 'Código',
  placeholder = 'Escanea o escribe un código',
  autoFocus,
}: ScanInputProps) {
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const detector = useRef(createHidDetector());
  const enterFromHid = useRef(false);
  const [scanner, setScanner] = useState<CameraScanner | null>(null);
  const lastCameraCode = useRef<{ text: string; at: number } | null>(null);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const canUseCamera = cameraAvailable();

  /** Clasifica y entrega la lectura; devuelve `true` si fue válida. */
  const handleRaw = (raw: string, source: ScanSource): boolean => {
    const result = classifyScan(raw);
    if (result.kind === 'invalid') {
      setMessage(INVALID_CODE_MESSAGE);
      return false;
    }
    setMessage(null);
    onScan(result, { source });
    return true;
  };

  const resetField = () => {
    setValue('');
    inputRef.current?.focus();
  };

  const onHidScan = useEffectEvent((code: string) => {
    handleRaw(code, 'hid');
    resetField();
  });

  useEffect(() => {
    if (!captureHid) return;
    return listenHid((code) => onHidScan(code));
  }, [captureHid]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const code = detector.current.handleKey(event.key, performance.now());
    if (event.key === 'Enter') enterFromHid.current = code !== null;
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const source: ScanSource = enterFromHid.current ? 'hid' : 'manual';
    enterFromHid.current = false;
    if (!value.trim()) return;
    handleRaw(value, source);
    resetField();
  };

  const openCamera = () => {
    primeScanFeedback();
    setScanner((current) => current ?? createCameraScanner());
    lastCameraCode.current = null;
    setMessage(null);
    setCameraOpen(true);
  };

  const onCameraCode = (text: string) => {
    const now = Date.now();
    const last = lastCameraCode.current;
    if (last && last.text === text && now - last.at < CAMERA_DEBOUNCE_MS) return;
    lastCameraCode.current = { text, at: now };
    if (!handleRaw(text, 'camera')) return;
    scanFeedback();
    // Sin devolver el foco al campo: en el celular abriría el teclado tras cada lectura.
    if (!continuous) setCameraOpen(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <form className="flex gap-2" onSubmit={onSubmit}>
        <Input
          ref={inputRef}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Escanear con la cámara"
          aria-describedby={canUseCamera ? undefined : hintId}
          disabled={!canUseCamera}
          onClick={openCamera}
        >
          <Camera />
        </Button>
      </form>
      {!canUseCamera && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {CAMERA_REQUIRES_HTTPS_MESSAGE}
        </p>
      )}
      {message && !cameraOpen && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {cameraOpen && scanner && (
        <CameraViewer
          scanner={scanner}
          message={message}
          onCode={onCameraCode}
          onClose={() => setCameraOpen(false)}
          onError={(error) => {
            setCameraOpen(false);
            setMessage(error);
          }}
        />
      )}
    </div>
  );
}
