import { safeNext, withNext } from './safeNext';

describe('safeNext (T10)', () => {
  it('respeta rutas internas', () => {
    expect(safeNext('/pos')).toBe('/pos');
    expect(safeNext('/pos?x=1')).toBe('/pos?x=1');
  });

  it.each(['//evil.com', 'https://evil.com', 'pos', '/\\evil.com', '', null, undefined])(
    '%p → /',
    (next) => {
      expect(safeNext(next)).toBe('/');
    },
  );

  it('withNext agrega la ruta actual salvo que sea /', () => {
    expect(withNext('/login', '/pos')).toBe('/login?next=%2Fpos');
    expect(withNext('/login', '/')).toBe('/login');
  });
});
