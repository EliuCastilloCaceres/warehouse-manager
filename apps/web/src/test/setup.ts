import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'node:util';
import { sessionStore } from '@/features/auth/sessionStore';
import { resetApiClient } from '@/shared/api/apiClient';
import { FakeBroadcastChannel } from './broadcast';
import { installMatchMedia, setScreenWidth } from './media';

// jsdom no expone TextEncoder/TextDecoder, y react-router los usa al cargar.
Object.assign(globalThis, { TextEncoder, TextDecoder, BroadcastChannel: FakeBroadcastChannel });
installMatchMedia();

// Radix (diálogos y hojas) y sonner (deslizar un toast) usan estas APIs que jsdom no implementa.
Object.assign(window.HTMLElement.prototype, {
  scrollIntoView: () => {},
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
});

beforeEach(() => {
  setScreenWidth(1024);
});

afterEach(() => {
  // Primero se desmonta la app: si no, limpiar la sesión la re-renderiza fuera de act().
  cleanup();
  sessionStore.clear();
  resetApiClient();
  FakeBroadcastChannel.reset();
  try {
    localStorage.clear();
  } catch {
    // sin almacenamiento
  }
});
