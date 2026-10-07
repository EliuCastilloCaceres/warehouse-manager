import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(webDir, '../..');

/** HTTPS solo si los dos archivos de certificado existen; si no, HTTP con aviso. */
function httpsOptions(keyPath: string | undefined, certPath: string | undefined) {
  const key = keyPath ? resolve(rootDir, keyPath) : undefined;
  const cert = certPath ? resolve(rootDir, certPath) : undefined;
  if (key && cert && existsSync(key) && existsSync(cert)) {
    return { key: readFileSync(key), cert: readFileSync(cert) };
  }
  console.warn(
    '\n[warehouse-manager] Sin certificados HTTPS (pnpm dev:certs): la web corre en HTTP y la cámara del celular no funcionará.\n',
  );
  return undefined;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, rootDir, '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(webDir, 'src') },
    },
    server: {
      host: true,
      port: 5173,
      https: command === 'serve' ? httpsOptions(env.DEV_HTTPS_KEY, env.DEV_HTTPS_CERT) : undefined,
      proxy: {
        '/api': { target: env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
      },
    },
  };
});
