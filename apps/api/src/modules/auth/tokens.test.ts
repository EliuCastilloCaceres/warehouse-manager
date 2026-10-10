import { createHash } from 'node:crypto';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

describe('refresh tokens (T5)', () => {
  it('generateRefreshToken produce 43 caracteres base64url distintos', () => {
    const tokens = Array.from({ length: 20 }, () => generateRefreshToken());
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(20);
  });

  it('hashRefreshToken es SHA-256 hex determinista', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(hash);
  });
});
