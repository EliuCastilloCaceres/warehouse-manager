import type { TicketWidth } from '@/shared/ticket/TicketHeader';

/**
 * Lo que recuerda cada dispositivo (spec F8 §3): la caja desde la que cobra, por sucursal, y
 * cómo imprime el ticket. Todo acceso a `localStorage` va en `try/catch`: sin almacenamiento,
 * no hay caja guardada y se imprime automático a 80 mm.
 */
export interface DeviceRegister {
  registerId: string;
  sessionId: string;
}

export const registerStorageKey = (branchId: string) => `wm.pos.register.${branchId}`;
export const AUTO_PRINT_KEY = 'wm.pos.autoPrint';
export const TICKET_WIDTH_KEY = 'wm.pos.ticketWidth';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento: el dispositivo no recuerda nada
  }
}

export function readDeviceRegister(branchId: string): DeviceRegister | null {
  const raw = read(registerStorageKey(branchId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeviceRegister>;
    return typeof value.registerId === 'string' && typeof value.sessionId === 'string'
      ? { registerId: value.registerId, sessionId: value.sessionId }
      : null;
  } catch {
    return null;
  }
}

export function writeDeviceRegister(branchId: string, value: DeviceRegister | null): void {
  write(registerStorageKey(branchId), value ? JSON.stringify(value) : null);
}

export interface TicketSettings {
  autoPrint: boolean;
  width: TicketWidth;
}

export function readTicketSettings(): TicketSettings {
  return {
    autoPrint: read(AUTO_PRINT_KEY) !== 'false',
    width: read(TICKET_WIDTH_KEY) === '58' ? 58 : 80,
  };
}

export function writeTicketSettings(settings: TicketSettings): void {
  write(AUTO_PRINT_KEY, String(settings.autoPrint));
  write(TICKET_WIDTH_KEY, String(settings.width));
}
