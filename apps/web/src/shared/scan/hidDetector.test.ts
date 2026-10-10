import { fireEvent } from '@testing-library/react';
import { createHidDetector, isEditableElement, listenHid } from './hidDetector';

/** Teclea `text` a `interval` ms por tecla y cierra con Enter; devuelve lo que emite el Enter. */
function burst(text: string, interval: number, start = 1000): string | null {
  const detector = createHidDetector();
  let time = start;
  for (const key of text) {
    expect(detector.handleKey(key, time)).toBeNull();
    time += interval;
  }
  return detector.handleKey('Enter', time);
}

describe('createHidDetector (T25)', () => {
  it('ZAP0101-25-NEG + Enter a 10 ms por tecla → emite', () => {
    expect(burst('ZAP0101-25-NEG', 10)).toBe('ZAP0101-25-NEG');
  });

  it('la misma cadena a 100 ms por tecla → no emite', () => {
    expect(burst('ZAP0101-25-NEG', 100)).toBeNull();
  });

  it('3 caracteres + Enter → no emite; 4 sí', () => {
    expect(burst('ZAP', 10)).toBeNull();
    expect(burst('ZAP0', 10)).toBe('ZAP0');
  });

  it('el límite es 35 ms entre teclas', () => {
    expect(burst('ZAP0101', 35)).toBe('ZAP0101');
    expect(burst('ZAP0101', 36)).toBeNull();
  });

  it('Shift y otras teclas sin carácter no rompen la ráfaga', () => {
    const detector = createHidDetector();
    ['Shift', 'Z', 'Shift', 'A', 'P', '0'].forEach((key, i) =>
      detector.handleKey(key, 1000 + i * 5),
    );
    expect(detector.handleKey('Enter', 1030)).toBe('ZAP0');
  });

  it('tras una pausa, la ráfaga empieza de nuevo con la siguiente tecla', () => {
    const detector = createHidDetector();
    detector.handleKey('x', 0);
    ['L', 'O', 'C', ':', 'A'].forEach((key, i) => detector.handleKey(key, 500 + i * 10));
    expect(detector.handleKey('Enter', 550)).toBe('LOC:A');
  });

  it('reset descarta la ráfaga en curso', () => {
    const detector = createHidDetector();
    ['Z', 'A', 'P', '0'].forEach((key, i) => detector.handleKey(key, i * 10));
    detector.reset();
    expect(detector.handleKey('Enter', 40)).toBeNull();
  });
});

describe('isEditableElement', () => {
  it.each([
    ['<input>', '<input />', true],
    ['<input type="search">', '<input type="search" />', true],
    ['<textarea>', '<textarea></textarea>', true],
    ['<select>', '<select></select>', true],
    ['<input type="checkbox">', '<input type="checkbox" />', false],
    ['<button>', '<button></button>', false],
    ['<div>', '<div></div>', false],
  ])('%s → %s', (_name, html, expected) => {
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(isEditableElement(container.firstElementChild)).toBe(expected);
  });

  it('contenteditable → true; null → false', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableElement(div)).toBe(true);
    expect(isEditableElement(null)).toBe(false);
  });
});

describe('listenHid (T25)', () => {
  let time = 0;
  const now = () => time;

  /** Despacha la ráfaga en `target`, a 10 ms por tecla, y devuelve el evento del Enter. */
  function type(target: Element, text: string) {
    for (const key of text) {
      fireEvent.keyDown(target, { key });
      time += 10;
    }
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(enter);
    return enter;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('con el foco fuera de campos editables emite y evita el Enter por defecto', () => {
    const onScan = jest.fn();
    const stop = listenHid(onScan, now);
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    const enter = type(button, 'ZAP0101-25-NEG');
    expect(onScan).toHaveBeenCalledWith('ZAP0101-25-NEG');
    expect(enter.defaultPrevented).toBe(true);
    stop();
  });

  it('con el foco en otro <input> → no emite', () => {
    const onScan = jest.fn();
    const stop = listenHid(onScan, now);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const enter = type(input, 'ZAP0101-25-NEG');
    expect(onScan).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    stop();
  });

  it('tecleo lento fuera de campos → no emite', () => {
    const onScan = jest.fn();
    const stop = listenHid(onScan, now);
    for (const key of 'ZAP0101') {
      fireEvent.keyDown(document.body, { key });
      time += 200;
    }
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
    stop();
  });

  it('al dejar de escuchar ya no emite', () => {
    const onScan = jest.fn();
    listenHid(onScan, now)();
    type(document.body, 'ZAP0101-25-NEG');
    expect(onScan).not.toHaveBeenCalled();
  });
});
