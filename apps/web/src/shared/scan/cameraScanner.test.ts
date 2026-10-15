import { createCameraScanner } from './cameraScanner';

/** Un `decodeFromConstraints` en curso: se resuelve, falla o "lee" un código a mano. */
interface MockDecode {
  video: HTMLVideoElement;
  controls: { stop: jest.Mock };
  read: (text: string) => void;
  open: () => void;
  fail: (error: unknown) => void;
}

const mockDecodes: MockDecode[] = [];

jest.mock('@zxing/browser', () => ({
  BarcodeFormat: { CODE_128: 4, EAN_13: 7, QR_CODE: 11 },
  BrowserMultiFormatReader: class {
    decodeFromConstraints(
      _constraints: MediaStreamConstraints,
      video: HTMLVideoElement,
      callback: (result: { getText: () => string } | undefined) => void,
    ) {
      return new Promise((resolve, reject) => {
        const controls = { stop: jest.fn() };
        mockDecodes.push({
          video,
          controls,
          read: (text) => callback({ getText: () => text }),
          open: () => resolve(controls),
          fail: reject,
        });
      });
    }
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const scanner = createCameraScanner();
  const listener = jest.fn();
  scanner.onCode(listener);
  return { scanner, listener };
}

beforeEach(() => {
  mockDecodes.length = 0;
});

describe('createCameraScanner: sesiones', () => {
  it('entrega las lecturas de la sesión abierta y, al reabrir, no las del bucle anterior', async () => {
    const { scanner, listener } = setup();
    const first = scanner.start(document.createElement('video'));
    await flush();
    mockDecodes[0]!.open();
    await first;
    mockDecodes[0]!.read('LOC:A-01-01');
    expect(listener).toHaveBeenLastCalledWith('LOC:A-01-01');

    scanner.stop();
    expect(mockDecodes[0]!.controls.stop).toHaveBeenCalled();
    const second = scanner.start(document.createElement('video'));
    await flush();
    mockDecodes[0]!.read('LOC:A-01-01'); // el último cuadro de la sesión anterior
    expect(listener).toHaveBeenCalledTimes(1);

    mockDecodes[1]!.open();
    await second;
    mockDecodes[1]!.read('LOC:A-01-02');
    expect(listener).toHaveBeenLastCalledWith('LOC:A-01-02');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('StrictMode (start → stop → start en el mismo video): abre la cámara una sola vez', async () => {
    const { scanner, listener } = setup();
    const video = document.createElement('video');
    const stale = scanner.start(video);
    scanner.stop();
    const current = scanner.start(video);
    await flush();
    await expect(stale).resolves.toBeUndefined();
    expect(mockDecodes).toHaveLength(1);

    mockDecodes[0]!.open();
    await current;
    mockDecodes[0]!.read('LOC:A-01-03');
    expect(listener).toHaveBeenCalledWith('LOC:A-01-03');
    scanner.stop();
    expect(mockDecodes[0]!.controls.stop).toHaveBeenCalledTimes(1);
  });

  it('cerrar mientras se pide el permiso y reabrir: la vieja suelta la cámara antes de abrir la nueva', async () => {
    const { scanner, listener } = setup();
    void scanner.start(document.createElement('video'));
    await flush();
    scanner.stop();
    const reopened = scanner.start(document.createElement('video'));
    await flush();
    expect(mockDecodes).toHaveLength(1); // la nueva espera a la anterior

    mockDecodes[0]!.read('LOC:A-01-01');
    mockDecodes[0]!.open();
    await flush();
    expect(mockDecodes[0]!.controls.stop).toHaveBeenCalled();
    expect(mockDecodes).toHaveLength(2);
    expect(listener).not.toHaveBeenCalled();

    mockDecodes[1]!.open();
    await reopened;
    mockDecodes[1]!.read('LOC:A-01-02');
    expect(listener).toHaveBeenCalledWith('LOC:A-01-02');
  });

  it('si la cámara falla, el error llega a quien abrió y la siguiente sesión arranca igual', async () => {
    const { scanner, listener } = setup();
    const denied = scanner.start(document.createElement('video'));
    await flush();
    mockDecodes[0]!.fail(new DOMException('denied', 'NotAllowedError'));
    await expect(denied).rejects.toThrow('denied');

    const retry = scanner.start(document.createElement('video'));
    await flush();
    mockDecodes[1]!.open();
    await retry;
    mockDecodes[1]!.read('LOC:A-01-01');
    expect(listener).toHaveBeenCalledWith('LOC:A-01-01');
  });
});
