import { manifest, pwaOptions, workbox } from './pwaManifest';

describe('PWA (T31)', () => {
  it('el manifest tiene nombre, idioma, modo standalone e inicio en /', () => {
    expect(manifest).toMatchObject({
      name: 'warehouse-manager',
      short_name: 'Almacén',
      lang: 'es-MX',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      orientation: 'portrait',
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('íconos 192, 512 y 512 maskable', () => {
    const icons = (manifest.icons ?? []).map(
      (icon) => `${icon.sizes}${icon.purpose ? ` ${icon.purpose}` : ''}`,
    );
    expect(icons).toEqual(['192x192', '512x512', '512x512 maskable']);
  });

  it('registro con prompt y apple-touch-icon incluido', () => {
    expect(pwaOptions.registerType).toBe('prompt');
    expect(pwaOptions.includeAssets).toContain('icons/apple-touch-icon-180x180.png');
  });

  it.each([
    ['/api/v1/health', true],
    ['/api/v1/auth/refresh', true],
    ['/uploads/product/x.webp', true],
    ['/pos', false],
    ['/warehouse/A-01-03', false],
    ['/apiario', false],
  ])('navigateFallbackDenylist con %s → %s', (path, denied) => {
    expect(workbox?.navigateFallback).toBe('/index.html');
    expect(workbox?.navigateFallbackDenylist?.some((pattern) => pattern.test(path))).toBe(denied);
  });

  it('precachea js, css, html, svg, png y woff2, sin runtimeCaching', () => {
    expect(workbox?.globPatterns).toEqual(['**/*.{js,css,html,svg,png,woff2}']);
    expect(workbox).not.toHaveProperty('runtimeCaching');
  });
});
