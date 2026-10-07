#!/usr/bin/env node
// Genera los certificados HTTPS de desarrollo con mkcert para localhost y la IP LAN.
// Uso: pnpm dev:certs [IP-LAN]   (sin argumento, la IP se detecta sola)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const certsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'certs');
const certFile = join(certsDir, 'dev-cert.pem');
const keyFile = join(certsDir, 'dev-key.pem');

/** Prioridad de rangos privados: primero la red doméstica/oficina típica. */
function rank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

function detectLanIp() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((addr) => addr && addr.family === 'IPv4' && !addr.internal)
    .map((addr) => addr.address)
    .sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

const lanIp = process.argv[2] ?? detectLanIp();
const hosts = ['localhost', '127.0.0.1', '::1', ...(lanIp ? [lanIp] : [])];

const probe = spawnSync('mkcert', ['-help'], { stdio: 'ignore' });
if (probe.error) {
  console.error(
    'No se encontró mkcert. Instálalo y ejecuta "mkcert -install" una vez; ' +
      'ver la sección "HTTPS en desarrollo" del README.',
  );
  process.exit(1);
}

mkdirSync(certsDir, { recursive: true });
const result = spawnSync('mkcert', ['-cert-file', certFile, '-key-file', keyFile, ...hosts], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error('mkcert no pudo generar los certificados.');
  process.exit(1);
}

console.log(`\nCertificados en infra/certs/ para: ${hosts.join(', ')}`);
if (lanIp) {
  console.log(`Desde el celular abre: https://${lanIp}:5173`);
} else {
  console.log('No se detectó una IP LAN; pásala como argumento: pnpm dev:certs 192.168.1.50');
}
