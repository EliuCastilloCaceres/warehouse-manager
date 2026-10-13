import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

// argon2id con el mínimo recomendado por OWASP.
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Sin caracteres que se confunden al leerlos o dictarlos: i, l, o, 0 y 1.
const READABLE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Contraseña de 12 caracteres en 3 grupos de 4 (p. ej. `k7mp-x3qa-9vtw`), con `crypto.randomInt`. */
export function generateReadablePassword(): string {
  const group = () =>
    Array.from({ length: 4 }, () => READABLE_ALPHABET[randomInt(READABLE_ALPHABET.length)]).join(
      '',
    );
  return [group(), group(), group()].join('-');
}
