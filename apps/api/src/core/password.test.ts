import { hashPassword, verifyPassword } from './password.js';

describe('contraseñas (T12)', () => {
  it('genera hashes argon2id que verifican solo con la contraseña correcta', async () => {
    const hash = await hashPassword('secreto-123');

    expect(hash).toMatch(/^\$argon2id\$/);
    const params = hash.split('$')[3]!.split(',').sort();
    expect(params).toEqual(['m=19456', 'p=1', 't=2']);
    await expect(verifyPassword(hash, 'secreto-123')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'otra-clave')).resolves.toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
    const [a, b] = await Promise.all([hashPassword('misma'), hashPassword('misma')]);
    expect(a).not.toBe(b);
  });
});
