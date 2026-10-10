import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CameraScanner } from './cameraScanner';
import { CAMERA_DEBOUNCE_MS, ScanInput } from './ScanInput';

// El adaptador real (`@zxing/browser`) se verifica a mano (CA7); aquí se simula.
const mockScanner: jest.Mocked<CameraScanner> = {
  start: jest.fn(),
  stop: jest.fn(),
  onCode: jest.fn(),
  torchSupported: jest.fn(),
  setTorch: jest.fn(),
};
jest.mock('./cameraScanner', () => ({ createCameraScanner: () => mockScanner }));

const vibrate = jest.fn();

function setCameraEnvironment({ secure = true, mediaDevices = true } = {}) {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: mediaDevices ? { getUserMedia: jest.fn() } : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  setCameraEnvironment();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  vibrate.mockReset();
  mockScanner.start.mockReset().mockResolvedValue(undefined);
  mockScanner.stop.mockReset();
  mockScanner.onCode.mockReset();
  mockScanner.torchSupported.mockReset().mockReturnValue(false);
  mockScanner.setTorch.mockReset().mockResolvedValue(undefined);
});

/** Lo que la cámara "lee": llama al listener que registró el visor. */
function cameraReads(text: string) {
  const listener = mockScanner.onCode.mock.calls.at(-1)![0];
  act(() => listener(text));
}

const field = () => screen.getByRole('textbox', { name: 'Código' });
const cameraButton = () => screen.getByRole('button', { name: 'Escanear con la cámara' });
const viewer = () => screen.queryByRole('dialog', { name: 'Escanear con la cámara' });

describe('ScanInput: tecleo y lector (T26)', () => {
  it.each([
    ['loc:a-1-3', { kind: 'location', code: 'A-01-03' }],
    ['PROMO:DESC10', { kind: 'promo', text: 'DESC10' }],
    ['zap0101-25-neg', { kind: 'product', code: 'ZAP0101-25-NEG' }],
  ])('"%s" + Enter → onScan(%o); el campo queda vacío y con foco', async (text, expected) => {
    const onScan = jest.fn();
    const user = userEvent.setup({ delay: 60 });
    render(<ScanInput onScan={onScan} />);

    await user.type(field(), `${text}{Enter}`);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(expected, { source: 'manual' });
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
  });

  it('"ZAP 01" → "Código no reconocido" sin onScan; la siguiente lectura válida lo quita', async () => {
    const onScan = jest.fn();
    const user = userEvent.setup();
    render(<ScanInput onScan={onScan} />);

    await user.type(field(), 'ZAP 01{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Código no reconocido');
    expect(onScan).not.toHaveBeenCalled();
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();

    await user.type(field(), 'LOC:A-01-03{Enter}');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Enter con el campo vacío no hace nada', async () => {
    const onScan = jest.fn();
    const user = userEvent.setup();
    render(<ScanInput onScan={onScan} />);

    await user.type(field(), '   {Enter}');
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('una ráfaga HID con el foco en el propio ScanInput emite una sola vez', async () => {
    const onScan = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(<ScanInput onScan={onScan} captureHid />);

    await user.type(field(), 'ZAP0101-25-NEG{Enter}');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(
      { kind: 'product', code: 'ZAP0101-25-NEG' },
      { source: 'hid' },
    );
  });

  it('con captureHid, una ráfaga con el foco fuera de campos llega a onScan y el campo toma el foco', () => {
    const onScan = jest.fn();
    render(<ScanInput onScan={onScan} captureHid />);

    for (const key of 'LOC:B-02-01') fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledWith({ kind: 'location', code: 'B-02-01' }, { source: 'hid' });
    expect(field()).toHaveFocus();
  });

  it('sin captureHid, la ráfaga fuera de campos se ignora', () => {
    const onScan = jest.fn();
    render(<ScanInput onScan={onScan} />);

    for (const key of 'LOC:B-02-01') fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe('ScanInput: cámara (T27)', () => {
  it('abre el visor; un código leído llama a onScan, vibra y cierra el visor', async () => {
    const onScan = jest.fn();
    const user = userEvent.setup();
    render(<ScanInput onScan={onScan} />);

    await user.click(cameraButton());
    expect(viewer()).toBeInTheDocument();
    expect(screen.getByText('Apunta al código de barras o al QR')).toBeInTheDocument();
    expect(mockScanner.start).toHaveBeenCalledWith(expect.any(HTMLVideoElement));

    cameraReads('ZAP0101-25-NEG');
    expect(onScan).toHaveBeenCalledWith(
      { kind: 'product', code: 'ZAP0101-25-NEG' },
      { source: 'camera' },
    );
    expect(vibrate).toHaveBeenCalledWith(100);
    expect(viewer()).not.toBeInTheDocument();
    expect(mockScanner.stop).toHaveBeenCalled();
  });

  it('una lectura inválida avisa en el visor y lo deja abierto', async () => {
    const onScan = jest.fn();
    const user = userEvent.setup();
    render(<ScanInput onScan={onScan} />);

    await user.click(cameraButton());
    cameraReads('ZAP 01');
    cameraReads('???');
    expect(onScan).not.toHaveBeenCalled();
    expect(viewer()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Código no reconocido');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('el mismo código dos veces en < 1,5 s → un solo onScan (continuous)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-10T12:00:00Z') });
    try {
      const onScan = jest.fn();
      render(<ScanInput onScan={onScan} continuous />);
      fireEvent.click(cameraButton());
      await act(async () => {});

      cameraReads('ZAP0101-25-NEG');
      act(() => jest.advanceTimersByTime(CAMERA_DEBOUNCE_MS - 100));
      cameraReads('ZAP0101-25-NEG');
      expect(onScan).toHaveBeenCalledTimes(1);

      cameraReads('LOC:A-01-03');
      expect(onScan).toHaveBeenCalledTimes(2);

      act(() => jest.advanceTimersByTime(CAMERA_DEBOUNCE_MS));
      cameraReads('LOC:A-01-03');
      expect(onScan).toHaveBeenCalledTimes(3);
      expect(viewer()).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('"Cerrar cámara" y Escape cierran el visor', async () => {
    const user = userEvent.setup();
    render(<ScanInput onScan={jest.fn()} />);

    await user.click(cameraButton());
    await user.click(screen.getByRole('button', { name: 'Cerrar cámara' }));
    expect(viewer()).not.toBeInTheDocument();

    await user.click(cameraButton());
    await user.keyboard('{Escape}');
    expect(viewer()).not.toBeInTheDocument();
    expect(mockScanner.stop).toHaveBeenCalledTimes(2);
  });

  it('permiso denegado → "No se pudo acceder a la cámara" y queda el modo manual', async () => {
    mockScanner.start.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const onScan = jest.fn();
    const user = userEvent.setup();
    render(<ScanInput onScan={onScan} />);

    await user.click(cameraButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo acceder a la cámara');
    expect(viewer()).not.toBeInTheDocument();

    await user.type(field(), 'LOC:A-01-03{Enter}');
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sin isSecureContext', { secure: false }],
    ['sin mediaDevices', { mediaDevices: false }],
  ])('%s → botón deshabilitado con "La cámara requiere HTTPS"', (_case, environment) => {
    setCameraEnvironment(environment);
    render(<ScanInput onScan={jest.fn()} />);

    expect(cameraButton()).toBeDisabled();
    expect(cameraButton()).toHaveAccessibleDescription('La cámara requiere HTTPS');
  });
});

describe('ScanInput: linterna (T28)', () => {
  it('con torchSupported: true aparece "Linterna" y alterna setTorch(true/false)', async () => {
    mockScanner.torchSupported.mockReturnValue(true);
    const user = userEvent.setup();
    render(<ScanInput onScan={jest.fn()} />);

    await user.click(cameraButton());
    const torch = await screen.findByRole('button', { name: 'Linterna' });
    expect(torch).toHaveAttribute('aria-pressed', 'false');

    await user.click(torch);
    expect(mockScanner.setTorch).toHaveBeenLastCalledWith(true);
    expect(torch).toHaveAttribute('aria-pressed', 'true');

    await user.click(torch);
    expect(mockScanner.setTorch).toHaveBeenLastCalledWith(false);
    expect(torch).toHaveAttribute('aria-pressed', 'false');
  });

  it('con torchSupported: false no aparece', async () => {
    const user = userEvent.setup();
    render(<ScanInput onScan={jest.fn()} />);

    await user.click(cameraButton());
    await waitFor(() => expect(mockScanner.torchSupported).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Linterna' })).not.toBeInTheDocument();
  });

  it('si setTorch falla, el botón desaparece', async () => {
    mockScanner.torchSupported.mockReturnValue(true);
    mockScanner.setTorch.mockRejectedValueOnce(new Error('no torch'));
    const user = userEvent.setup();
    render(<ScanInput onScan={jest.fn()} />);

    await user.click(cameraButton());
    await user.click(await screen.findByRole('button', { name: 'Linterna' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Linterna' })).not.toBeInTheDocument(),
    );
  });
});
