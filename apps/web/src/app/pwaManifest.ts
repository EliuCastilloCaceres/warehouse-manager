import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa';

/** Fondo de shadcn (`--background`): coincide con el header de la app. */
export const THEME_COLOR = '#ffffff';

export const manifest: Partial<ManifestOptions> = {
  name: 'warehouse-manager',
  short_name: 'Almacén',
  description: 'Almacén y punto de venta',
  lang: 'es-MX',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  theme_color: THEME_COLOR,
  background_color: THEME_COLOR,
  icons: [
    { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    {
      src: '/icons/maskable-icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

/**
 * Solo se precachean los *assets* de la SPA. `/api` y `/uploads` nunca salen de la caché ni caen
 * en el `navigateFallback` (spec F3 §8.14), y no hay `runtimeCaching`.
 */
export const workbox: VitePWAOptions['workbox'] = {
  globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
  cleanupOutdatedCaches: true,
};

/** `prompt`: una versión nueva espera a que el usuario toque "Actualizar" (no recarga a mitad de una venta). */
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  // El registro va en main.tsx con `virtual:pwa-register`.
  injectRegister: false,
  includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon-180x180.png'],
  manifest,
  workbox,
};
