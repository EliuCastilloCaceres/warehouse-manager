---
id: fase-10
titulo: Endurecimiento, despliegue y entrega
estado: LISTA
depende_de: [fase-09]
autoriza_codigo_en:
  - "infra/**"
  - ".github/workflows/**"
  - ".dockerignore"
  - ".gitattributes"
  - "e2e/**"
  - "package.json"
  - "pnpm-lock.yaml"
  - "pnpm-workspace.yaml"
  - ".gitignore"
  - ".env.example"
  - "apps/api/Dockerfile"
  - "apps/api/package.json"
  - "apps/api/tsconfig.build.json"
  - "apps/api/src/core/config.ts"
  - "apps/api/src/core/config.test.ts"
  - "apps/api/src/core/security.ts"
  - "apps/api/src/core/swagger.ts"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/scripts/**"
  - "apps/api/prisma/seed/volume.ts"
  - "apps/api/test/integration/hardening-*.int.test.ts"
  - "apps/api/test/integration/performance-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "docs/guides/**"
  - "docs/manual/**"
  - "docs/uat/**"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "La migración al VPS en sí: F10 la deja documentada y probada en ensayo (restaurar un respaldo en otro equipo), pero no contrata ni configura el VPS"
  - "Copia de respaldos en la nube (bucket); al migrar al VPS se define con una spec o un cambio declarado"
  - "Acceso al sistema desde fuera de la tienda (VPN o túnel) mientras el servidor sea local"
  - "Monitoreo externo (Uptime Kuma u otro): F10 solo deja /api/v1/health accesible para conectarlo después"
  - "Alta disponibilidad, réplicas de BD, CDN, registry de imágenes y despliegue continuo (CD)"
  - "Compresión brotli (requiere compilar un módulo de Nginx); se usa gzip"
  - "Funcionalidad nueva de cualquier módulo (F4–F9) y todo el roadmap del plan §11"
  - "Cambios a schema.prisma o migraciones"
tests_requeridos_total: 21
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; los umbrales de F0–F9 se mantienen en todo el monorepo"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 10: Endurecimiento, despliegue y entrega

## 1. Contexto y alcance

Referencias: plan §2.3 (despliegue), §6.1 (cabeceras, rate limit), §8 Fase 10, §9 (pruebas, CI y e2e), §10 (servicios, VPS vs. servidor local, observabilidad), §12 (riesgos: HTTPS y cámara, rendimiento) y §13.8 y §13.13 (respondidas el 2026-10-06). Recoge lo que las specs anteriores dejaron para aquí: CI (F0), protección de `/api/docs` (F0, F2), rate limit global y `TRUST_PROXY` de producción (F2), `/uploads` servido por Nginx (F2), CSP de la SPA y e2e con Playwright (F3) y el uso del comando del Propietario en producción (F4).

**Decisiones del usuario (2026-10-06):**

- **Despliegue:** primero en un **servidor local en la tienda**; se planea migrar a un **VPS con dominio propio** en un futuro cercano.
- **TLS en el servidor local:** se compra el dominio ya; certificado de Let's Encrypt por **desafío DNS** con un registro que apunta a la IP local del servidor (plan §10.2 opción a). Los celulares no instalan nada y el mismo dominio sirve después para el VPS.
- **Volumen:** pequeño, hasta ~2 000 variantes, ~100 ventas al día por sucursal, ~200 racks y hasta 5 usuarios a la vez.
- **CI:** GitHub Actions con lint, typecheck, tests, build y e2e de Playwright.
- **Respaldos:** copia diaria fuera del servidor en un **disco externo o NAS** de la tienda.
- **Modo local de pruebas:** antes de comprar el dominio, el stack completo de producción se despliega y se prueba sin dominio, primero en la PC de desarrollo (Windows) y después en el servidor de la tienda, con certificado de **mkcert** (como en F0); al comprar el dominio se cambia a Let's Encrypt sin reinstalar.

**Objetivo:** dejar el sistema listo para producción en la tienda, verificado y aceptado por el cliente, y sin decisiones que impidan pasar al VPS. Al terminar F10:

- el stack completo se despliega en **modo local** (sin dominio, mkcert) en una PC con Windows y en el servidor de la tienda, para probarlo antes de comprar el dominio;
- el sistema se instala desde cero en el servidor de la tienda siguiendo la guía en menos de 1 hora, y se abre por `https://<subdominio>.<dominio>` desde celulares y PC sin avisos de certificado;
- la seguridad está revisada: cabeceras y CSP, rate limit global, todas las rutas con su acceso, `/api/docs` protegido y límites de subida;
- el rendimiento está medido con el volumen confirmado (con margen) y los índices clave se usan;
- hay respaldo diario de BD y fotos, copiado al disco externo, y la restauración está probada;
- la CI valida cada cambio, incluidos los flujos críticos de punta a punta;
- existen las guías de instalación, operación y migración al VPS, el manual de usuario por módulo y la lista de UAT firmada por el cliente.

**Alcance (entra):**

1. Imágenes de producción (`api` y `nginx` con la SPA), `docker-compose.yml` de producción, migraciones al arrancar y comandos de operación dentro del contenedor.
2. Nginx: TLS en dos modos (`local` con mkcert y `letsencrypt` con `certbot` por DNS-01 y su renovación), cabeceras, CSP, gzip, caché, límites y proxy.
3. Endurecimiento de la API: rate limit global, `TRUST_PROXY`, Swagger en producción y la auditoría de acceso de todas las rutas.
4. Respaldos con rotación, copia al disco externo, aviso de respaldo vencido y restauración probada.
5. Semilla de volumen y pruebas de rendimiento.
6. E2E con Playwright y CI en GitHub Actions.
7. Documentación (instalación, operación, migración al VPS, manual de usuario) y UAT.

**Fuera de alcance:** ver la cabecera. **Regresiones declaradas:** F0 registraba Swagger solo fuera de producción; ahora depende de `DOCS_ENABLED`, cuyo default fuera de producción es `true`, así que F0 T6 sigue en verde sin cambios. F2 T1 (defaults de la config) se adapta a las variables nuevas de §4. `infra/scripts/dev-certs.mjs` (F0) acepta `--name` y la IP para generar también el certificado del modo local (§3.2); sin argumentos se comporta igual que antes (F0 no tiene tests automáticos de ese script; su verificación manual sigue valiendo). Son los únicos cambios permitidos sobre entregables de F0 y F2.

---

## 2. Modelo de datos afectado

Sin cambios de schema ni migraciones. F10 verifica (T19) que las consultas críticas usan los índices que ya declara F1: `ProductVariant.sku`, `Rack.locationCode`, `Sale[branchId, createdAt]` y `StockLocation.variantId`.

---

## 3. Decisiones técnicas

### 3.1 Servidor y red (servidor local)

| Tema | Decisión |
|---|---|
| Sistema operativo | Ubuntu Server 24.04 LTS con Docker Engine y el plugin Compose (no Docker Desktop). |
| Equipo mínimo | 2 núcleos, 4 GB de RAM, SSD de 64 GB, red por cable y no-break (UPS) recomendado. Sobra para el volumen confirmado. |
| IP | Fija por reserva DHCP en el router de la tienda. |
| Nombre | Un subdominio del dominio comprado (`APP_DOMAIN`, p. ej. `almacen.<dominio>`) con un registro `A` hacia la IP **local** del servidor. Solo resuelve a algo útil dentro de la red de la tienda. |
| DNS | Cloudflare (gratuito) como DNS del dominio, porque `certbot` tiene su plugin y permite un token limitado a la zona. Si el dominio se compra en otro registrador, se delegan sus servidores de nombres a Cloudflare. |
| *DNS rebinding* | Algunos routers bloquean respuestas DNS con IP privada. La guía indica cómo permitir el dominio en el router o, si no se puede, agregar una entrada DNS local; la verificación de instalación lo comprueba desde un celular. |
| Puertos | Solo `nginx` publica `80` y `443` en el host. `postgres` y `api` no publican puertos. |
| PC con Windows (modo local) | Docker Desktop con WSL2. La guía indica la regla del Firewall de Windows para los puertos 80 y 443 (perfil de red privada), la ruta de Windows para `BACKUP_EXTERNAL_DIR` (p. ej. `D:/wm-backups`) y que la PC no se suspenda durante las pruebas. `.gitattributes` fuerza `eol=lf` en `*.sh`, `*.conf` y los archivos de `infra/`, para que los scripts de los contenedores no fallen con CRLF al clonar en Windows. |

### 3.2 Modos de TLS

`TLS_MODE` en `.env` elige cómo obtiene Nginx su certificado. Los datos (volúmenes `pgdata`, `uploads` y `backups`) no dependen del modo, así que cambiar de uno a otro no reinstala nada.

| Tema | `local` (sin dominio, para probar) | `letsencrypt` (con dominio) |
|---|---|---|
| Certificado | `infra/certs/local-cert.pem` y `local-key.pem`, generados con `pnpm dev:certs -- --name local --ip <IP-LAN>` (mkcert, F0). SANs: la IP LAN del equipo, `localhost` y `127.0.0.1`. Se montan de solo lectura en `nginx`. | Let's Encrypt por DNS-01 con `certbot` (§3.3), en el volumen `certs`. |
| Acceso | `https://<IP-LAN>` desde los equipos de la red. Cada celular y PC instala una vez la CA raíz de mkcert (procedimiento del README de F0). | `https://<APP_DOMAIN>`, sin instalar nada. |
| `server_name` | `_` (cualquiera). | `APP_DOMAIN`. |
| HSTS | No se envía, para no fijar HTTPS a una IP o nombre de prueba. | Sí (§3.4). |
| `certbot` | No se crea: el servicio está en el perfil de Compose `letsencrypt`. | `COMPOSE_PROFILES=letsencrypt` lo activa. |
| Variables exigidas | `TLS_MODE=local`. `APP_DOMAIN`, `CERTBOT_EMAIL` e `infra/secrets/cloudflare.ini` no se necesitan. | `APP_DOMAIN`, `CERTBOT_EMAIL` y `cloudflare.ini`. |
| Cambio de IP | Si la IP del equipo cambia (DHCP de la PC), se regenera el certificado con la IP nueva y se reinicia `nginx`. | Se actualiza el registro `A`; el certificado no cambia. |

El *entrypoint* de `nginx` lee `TLS_MODE` y genera la configuración correspondiente desde una plantilla (`envsubst`); con un valor distinto de `local` o `letsencrypt` termina con código 1 y un mensaje que nombra la variable. El modo **local** es también el que usa el stack de e2e (§3.9), así que la CI lo prueba en cada cambio.

### 3.3 Contenedores (`infra/docker-compose.yml`)

| Servicio | Imagen | Volúmenes | Notas |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `pgdata` | Healthcheck `pg_isready`. Contraseña desde `.env`. |
| `api` | `apps/api/Dockerfile` (multi-stage, `node:24-alpine`) | `uploads` | Al arrancar: `prisma migrate deploy` y luego `node dist/server.js`. Usuario sin privilegios. Healthcheck contra `/api/v1/health`. Depende de `postgres` sano. |
| `nginx` | `infra/nginx/Dockerfile` (etapa 1: build de `apps/web`; etapa 2: `nginx:alpine`) | `uploads` (solo lectura), `certs` (solo lectura), `infra/certs` (solo lectura, modo local) | Sirve la SPA y `/uploads`, hace proxy de `/api`. Configuración según `TLS_MODE` (§3.2). Recarga la configuración cada 12 h para tomar certificados renovados. |
| `certbot` | `certbot/dns-cloudflare` | `certs`, `infra/secrets/cloudflare.ini` (solo lectura) | Solo en el perfil `letsencrypt`. Obtiene el certificado de `APP_DOMAIN` por DNS-01 y lo renueva (intento cada 12 h). |
| `backup` | `infra/backup/Dockerfile` (`postgres:16-alpine` + `crond`) | `backups`, `uploads` (solo lectura), `BACKUP_EXTERNAL_DIR` (montaje del host) | Ver §3.6. |

- Todos con `restart: unless-stopped`, `TZ=America/Mexico_City` y logs `json-file` con `max-size: 10m` y `max-file: 5` (plan §10.3).
- `infra/.env.production.example` documenta cada variable (§4). El `.env` real y `infra/secrets/` no se versionan.
- **Imagen `api`:** `pnpm deploy --filter api --prod` en la etapa final. La CLI `prisma` pasa de `devDependencies` a `dependencies` de `apps/api` para poder migrar al arrancar. El seed base y el seed de demo se compilan con `src` (`tsconfig.build.json` incluye `prisma/seed*`) para correrlos con `node`, sin `tsx`.
- **Comandos de operación** (documentados en la guía): `docker compose run --rm api node dist/prisma/seed.js` (alta del Propietario y el Administrador iniciales, idempotente) y `docker compose run --rm api node dist/scripts/owner-reset-password.js` (F4).

### 3.4 Nginx (`infra/nginx/`)

| Tema | Decisión |
|---|---|
| HTTP | El puerto 80 solo redirige a HTTPS (301). |
| TLS | TLS 1.2 y 1.3, cifrados de la configuración "intermediate" de Mozilla, OCSP stapling desactivado (Let's Encrypt lo retiró) y `ssl_session_cache`. Certificado según `TLS_MODE` (§3.2): de `infra/certs` en modo local o del volumen `certs` con `letsencrypt`. En modo local, si falta el archivo, `nginx` termina con código 1 y un mensaje que indica correr `pnpm dev:certs -- --name local --ip <IP-LAN>`. Con `letsencrypt`, si aún no existe (primer arranque), Nginx arranca con un certificado autofirmado temporal que genera su *entrypoint*, para no quedar caído. |
| Cabeceras | `Strict-Transport-Security: max-age=31536000` solo con `letsencrypt` (sin `includeSubDomains` ni `preload`, para no afectar otros subdominios), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY` y `Permissions-Policy: camera=(self), microphone=(), geolocation=()`. |
| CSP (SPA) | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. `'unsafe-inline'` en estilos porque Radix y `PrintLayout` inyectan estilos. Sin `'unsafe-eval'`. En `/api/docs` se usa una CSP propia que permite lo que necesita Swagger UI. |
| Caché | `/assets/*` (con hash): `Cache-Control: public, max-age=31536000, immutable`. `index.html`, `sw.js`, `registerSW.js` y `manifest.webmanifest`: `no-cache`. `/uploads/*` (nombres con UUID): `public, max-age=2592000` y `nosniff`. |
| SPA | `try_files $uri /index.html` fuera de `/api/` y `/uploads/`; un archivo que no existe en `/uploads/` da 404 (no cae en la SPA). |
| Proxy `/api` | Hacia `api:3000`, con `X-Forwarded-For`, `X-Forwarded-Proto` y `Host`; `proxy_read_timeout 60s`. |
| Límites | `client_max_body_size 12m` (imágenes de hasta 10 MiB y `.xlsx` de hasta 5 MiB, más el margen de multipart). La API conserva sus propios límites (F2, F6). |
| gzip | Para `text/*`, `application/javascript`, `application/json`, `image/svg+xml` y `application/manifest+json`, a partir de 1 KiB. |
| `/api/docs` | Protegido con autenticación básica (`auth_basic`) contra `infra/secrets/docs.htpasswd`, que la guía enseña a generar. |

### 3.5 API

| Tema | Decisión |
|---|---|
| Rate limit global | `@fastify/rate-limit` pasa a `global: true` con clave = `userId` si la petición trae un JWT válido, y `ip` si no. Límites: 600/min por usuario y 120/min por IP sin autenticar. Se mantienen los límites de auth de F2. Respuesta 429 `RATE_LIMITED` con `Retry-After`. En el VPS todos los equipos de la tienda saldrán con la misma IP pública: por eso la clave es el usuario. `/api/v1/health` queda exento. |
| `TRUST_PROXY` | En producción, `true`: la API solo es accesible a través de Nginx, en la red interna de Compose. |
| Swagger | Se registra si `DOCS_ENABLED=true` (por defecto `true` fuera de producción y `false` en producción, pero el compose de producción lo activa porque `/api/docs` queda protegido por Nginx). |
| Config de producción | Con `NODE_ENV=production`, `loadConfig` exige `COOKIE_SECURE=true` y `TRUST_PROXY=true`, y rechaza el `JWT_SECRET` de ejemplo de `.env.example`. |
| Auditoría de rutas | Además del `onRoute` de F2, un test recorre todas las rutas registradas: las `public` son exactamente una lista cerrada (`health`, `auth/login`, `auth/refresh` y `auth/logout`), las `authenticated` son una lista cerrada (p. ej. `auth/me`, `auth/change-password`) y todas las demás declaran un permiso del catálogo. |

### 3.6 Respaldos

| Tema | Decisión |
|---|---|
| Qué | `pg_dump -Fc` de la BD y un `tar.gz` del volumen `uploads`, con el mismo sello de fecha: `wm-YYYYMMDD-HHMM.dump` y `wm-YYYYMMDD-HHMM-uploads.tar.gz`, más un `.sha256` de cada uno. |
| Cuándo | Todos los días a las 02:00 (hora de la tienda) y bajo demanda con `docker compose exec backup backup-now`. |
| Dónde | Volumen `backups` en el servidor (14 días) y copia en `BACKUP_EXTERNAL_DIR`, el disco externo o la carpeta del NAS montada en el host (30 días). |
| Disco no disponible | Si `BACKUP_EXTERNAL_DIR` no está montado o no se puede escribir, el respaldo local se hace igual, el error queda en el log y el respaldo cuenta como "sin copia externa". |
| Aviso | El healthcheck del servicio `backup` falla si el último respaldo completo con copia externa tiene más de 26 h; `docker compose ps` lo muestra como `unhealthy`, y la guía de operación indica revisarlo cada semana. |
| Restauración | `infra/scripts/restore.sh <sello>`: verifica los `.sha256`, detiene `api`, restaura la BD con `pg_restore --clean --if-exists`, reemplaza el contenido de `uploads` y vuelve a levantar `api` (que migra si el respaldo era de una versión anterior). Pide confirmación escribiendo el nombre de la sucursal, salvo `--yes`. |
| Prueba | T12 lo ejecuta en la CI; la guía exige además un simulacro de restauración en otro equipo antes de la entrega (CA4), que sirve de ensayo de la migración al VPS. |

### 3.7 Migración al VPS (documentada, no ejecutada)

`docs/guides/migracion-vps.md`: crear el VPS (Ubuntu 24.04, mismas medidas mínimas), instalar Docker, clonar el repositorio, copiar `.env` e `infra/secrets/`, levantar, restaurar el último respaldo con `restore.sh`, cambiar el registro `A` de `APP_DOMAIN` a la IP pública del VPS y verificar. El certificado sigue por DNS-01, así que no cambia nada de TLS. Antes de migrar se debe decidir la copia de respaldos fuera del VPS (fuera de alcance de F10) y el acceso al puerto 22 solo con llave.

### 3.8 Rendimiento

| Tema | Decisión |
|---|---|
| Semilla de volumen | `apps/api/prisma/seed/volume.ts` (`pnpm seed:volume`, nunca en producción: sale con código 1 si `NODE_ENV=production`). Crea el **doble** del volumen confirmado: 4 000 variantes (en ~800 productos), 400 racks con stock y 365 días de ventas a 100 diarias (36 500 ventas con partidas y pagos), en `S1`. |
| Umbrales | Medidos contra la API con BD real, mediana de 5 llamadas tras una de calentamiento y con 5 clientes en paralelo: lista del catálogo (página de 20 con búsqueda) < 300 ms; árbol del mapa < 500 ms; contenido de un rack < 300 ms; `GET /pos/lookup` < 200 ms; reporte de un mes < 1 s (criterio de F9). |
| Índices | Se verifica con `EXPLAIN` que esas consultas no hacen *Seq Scan* sobre `sale`, `product_variant`, `rack` ni `stock_location`. |

### 3.9 E2E y CI

| Tema | Decisión |
|---|---|
| Playwright | Proyecto `e2e/` en la raíz (`@playwright/test`), contra el stack de producción levantado con `infra/docker-compose.e2e.yml` en **modo local** (`TLS_MODE=local`, certificado para `localhost` firmado por una CA de prueba que la CI genera con `openssl` y coloca en `infra/certs`; sin `backup`; BD desechable con seed base y de demo). `ignoreHTTPSErrors: true`. Dos proyectos: `mobile` (Pixel 7) y `desktop` (1366×768). El escaneo se simula tecleando en `ScanInput` (ráfaga HID); la cámara no se prueba en e2e (CA de F3 y F7). `window.print` se intercepta. |
| CI | `.github/workflows/ci.yml` en `pull_request` y `push` a `main` y `testing`. Jobs: **checks** (Node 24, pnpm con caché, servicio `postgres:16`; `lint`, `typecheck`, `test` con cobertura y `build`), **e2e** (necesita `checks`; construye las imágenes, levanta el stack e2e, corre Playwright y sube el reporte como artefacto si falla) y **backup** (necesita `checks`; corre T12). |
| Rendimiento en CI | T19 corre en el job **checks** con la semilla de volumen; los umbrales se multiplican por 2 en CI (`PERF_FACTOR=2`), porque los runners son más lentos que el servidor; en el servidor real se corren con factor 1 al instalar (CA3). |

### 3.10 Documentación y UAT

| Documento | Contenido |
|---|---|
| `docs/guides/instalacion.md` | Tres partes. **A. Modo local en Windows** (PC de pruebas): Docker Desktop con WSL2, regla del firewall, IP LAN, `pnpm dev:certs -- --name local --ip <IP>`, instalar la CA de mkcert en celulares y PC (remite al README de F0), `.env` con `TLS_MODE=local`, primer arranque, seed inicial y verificación desde un celular (login, cámara e impresión). **B. Modo local en Ubuntu** (servidor de la tienda): requisitos del equipo y de red, instalación de Docker, lo mismo que A y las impresoras (TM-T20III y RT-420ME como impresoras del sistema, márgenes en 0). **C. Pasar al dominio**: compra, DNS en Cloudflare, token de API, registro `A`, *DNS rebinding*, `.env` (`TLS_MODE=letsencrypt`, `COMPOSE_PROFILES=letsencrypt`, `APP_DOMAIN`, `CERTBOT_EMAIL`), `cloudflare.ini`, `docker compose up -d` (los datos se conservan) y verificación final. La instalación desde cero con dominio (B + C) se mide contra el reloj (CA1). |
| `docs/guides/operacion.md` | Respaldos (dónde, revisar el estado, respaldo manual), restauración, actualización (`git pull`, `docker compose build`, `up -d`; las migraciones corren solas), reinicio, logs, renovación del certificado, contraseña de `/api/docs`, restablecer la contraseña del Propietario y qué hacer si el disco externo falla. |
| `docs/guides/migracion-vps.md` | §3.7. |
| `docs/manual/*.md` | Manual breve por módulo, para el personal: inicio de sesión, almacén, productos, POS (atender, cobrar, corte), reportes, usuarios y ajustes. Con capturas tomadas del sistema en el celular. |
| `docs/uat/checklist.md` | Lista de verificación por módulo (casos del día a día en la tienda), con columna de resultado, hallazgos y firma. Los hallazgos que sean defectos se corrigen en F10 si están dentro del alcance de F0–F9; lo nuevo va al roadmap (plan §11). |

---

## 4. Configuración

**API** (`apps/api/src/core/config.ts`, extendido):

| Variable | Tipo | Default |
|---|---|---|
| `DOCS_ENABLED` | `'true'` \| `'false'` → boolean | `true` fuera de producción, `false` en producción |
| `RATE_LIMIT_USER_PER_MIN` | entero 10–10 000 (coerce) | `600` |
| `RATE_LIMIT_ANON_PER_MIN` | entero 10–10 000 (coerce) | `120` |

**Producción** (`infra/.env.production.example`): `TLS_MODE` (`local` o `letsencrypt`), `COMPOSE_PROFILES` (vacío en modo local, `letsencrypt` con dominio), `APP_DOMAIN` y `CERTBOT_EMAIL` (solo con `letsencrypt`), `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TTL_MIN`, `REFRESH_TTL_DAYS`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `UPLOADS_DIR=/data/uploads`, `DOCS_ENABLED=true`, `OWNER_INITIAL_PASSWORD`, `ADMIN_INITIAL_PASSWORD`, `BACKUP_EXTERNAL_DIR`, `BACKUP_LOCAL_DAYS=14`, `BACKUP_EXTERNAL_DAYS=30`, `TZ=America/Mexico_City` y `APP_VERSION`. Secretos aparte en `infra/secrets/`: `cloudflare.ini` (token con permiso solo de DNS de la zona; solo con `letsencrypt`) y `docs.htpasswd`. Certificados del modo local en `infra/certs/` (ya ignorado por git desde F0).

---

## 5. Dependencias autorizadas (lista cerrada)

| Paquete | Dependencias | DevDependencies |
|---|---|---|
| raíz | — | `@playwright/test` |
| `apps/api` | `prisma` (se mueve desde `devDependencies`) | — |

Imágenes Docker: `node:24-alpine`, `nginx:alpine`, `postgres:16-alpine` y `certbot/dns-cloudflare`, con etiqueta de versión fija (no `latest`). Herramientas fuera de npm: Docker Engine con Compose en el servidor.

---

## 6. Contratos y endpoints

Sin endpoints nuevos ni cambios de contratos. En `shared/errors.ts` y `core/errors.ts` no hay códigos nuevos (`RATE_LIMITED` ya existe desde F2). `GET /api/v1/health` responde también a través de Nginx para el monitoreo futuro.

---

## 7. Pantallas

N/A en esta fase (sin pantallas nuevas). La CSP y la caché no deben cambiar nada visible: lo comprueban los e2e (§10).

---

## 8. Reglas y casos borde

1. **Primer arranque sin certificado (`letsencrypt`):** Nginx sirve con uno autofirmado temporal hasta que `certbot` obtiene el real; tras la siguiente recarga (o `docker compose exec nginx nginx -s reload`) usa el de Let's Encrypt.
2. **Renovación:** `certbot` renueva a los 60 días; Nginx recarga cada 12 h. Un fallo de renovación queda en el log de `certbot` y la guía indica revisarlo.
3. **Router con protección de *DNS rebinding*:** el dominio no resuelve dentro de la tienda; la guía da los dos remedios y la verificación final lo detecta.
4. **Cambio de IP del servidor:** se actualiza el registro `A`; el certificado no cambia.
5. **Migraciones al actualizar:** `api` corre `prisma migrate deploy` antes de escuchar; si falla, el contenedor termina con código 1 y no atiende con un schema a medias. La guía pide respaldar antes de actualizar.
6. **Disco externo desconectado:** el respaldo local sigue; el servicio queda `unhealthy` a las 26 h.
7. **Restaurar en una versión más nueva:** `restore.sh` restaura y `api` aplica las migraciones pendientes al arrancar.
8. **Rate limit en la tienda:** 5 usuarios con uso normal quedan muy por debajo de 600/min cada uno; un 429 se muestra con el mensaje estándar y la petición puede reintentarse.
9. **`/api/docs` sin credenciales:** 401 de Nginx; la API sigue sin exponer Swagger fuera de esa ruta.
10. **Subida de más de 12 MiB:** 413 de Nginx antes de llegar a la API.
11. **Actualización de la PWA:** como `sw.js` e `index.html` no se cachean en el navegador, los equipos ven el aviso "Hay una nueva versión disponible" (F3) después de actualizar.
12. **`seed:volume` en producción:** se niega y termina con código 1.
13. **Modo local con IP cambiada:** el certificado ya no coincide y los celulares muestran aviso; se regenera con la IP nueva y se reinicia `nginx` (la guía lo indica y recomienda reservar la IP en el router).
14. **Equipo sin la CA de mkcert** (modo local): el navegador muestra el aviso de certificado y la cámara no funciona hasta instalar la CA.
15. **Cambio de modo (`local` → `letsencrypt`):** no toca `pgdata`, `uploads` ni `backups`; los usuarios, ventas y fotos siguen. Los equipos entran ahora por el dominio; la CA de mkcert puede quitarse de los celulares.
16. **`TLS_MODE` inválido o certificado local faltante:** `nginx` no arranca y su log nombra la variable o el comando para generarlo.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Endurecimiento de la API.**
  - Extender `config.ts` (§4 y reglas de producción), rate limit global en `security.ts`, `DOCS_ENABLED` en `swagger.ts`; adaptar F2 T1. Tests **T1–T4**.
  - *Verificable:* T1–T4 en verde, y los tests de F0 y F2 siguen en verde.
- [ ] **2. Imágenes y compose de producción.**
  - `apps/api/Dockerfile` (con migrar al arrancar y seed compilado), `infra/nginx/` (Dockerfile, plantillas por `TLS_MODE` y *entrypoint*), `infra/docker-compose.yml` (con `certbot` en el perfil `letsencrypt`), `infra/.env.production.example`, `.dockerignore`, `.gitattributes` y `--name`/`--ip` en `dev-certs.mjs`. Tests **T5–T9** (smoke contra el stack e2e, en modo local).
  - *Verificable:* `docker compose -f infra/docker-compose.yml -f infra/docker-compose.e2e.yml up -d` deja todos los servicios `healthy`; T5–T9 en verde.
- [ ] **3. Certificados.**
  - Modo local con el certificado de `infra/certs`; servicio `certbot` con DNS-01 y recarga de Nginx; cambio de modo. Tests **T10** y **T21**.
  - *Verificable:* T10 y T21 en verde. El certificado real se emite en el TODO 9b.
- [ ] **4. Respaldos y restauración.**
  - `infra/backup/` (Dockerfile, `backup-now`, rotación, copia externa, healthcheck) e `infra/scripts/restore.sh`. Tests **T11–T12**.
  - *Verificable:* T11 y T12 en verde.
- [ ] **5. Rendimiento.**
  - `seed/volume.ts`, `seed:volume` y las pruebas de tiempos e índices. Test **T19**; corregir lo que no cumpla sin cambiar el schema (si hiciera falta un índice nuevo, se pregunta).
  - *Verificable:* T19 en verde.
- [ ] **6. E2E.**
  - `e2e/` (configuración, `docker-compose.e2e.yml`, ayudas de login y escaneo) y los flujos. Tests **T13–T18** y **T20**.
  - *Verificable:* T13–T18 y T20 en verde en `mobile` y `desktop`.
- [ ] **7. CI.**
  - `.github/workflows/ci.yml` con los jobs de §3.9.
  - *Verificable:* la CI pasa en verde en un PR hacia `main` (enlace en Evidencia).
- [ ] **8. Documentación.**
  - Guías de instalación, operación y migración al VPS; manual por módulo; README (enlaces a las guías y comandos de producción).
  - *Verificable:* revisión del usuario.
- [ ] **9a. Ensayo en modo local (sin dominio).**
  - Instalar en la PC con Windows (guía A) y después en el servidor de la tienda (guía B), en `TLS_MODE=local`. Desde un celular con la CA de mkcert: login, escaneo con cámara, una venta e impresión del ticket. Corregir la guía con lo que se encuentre.
  - *Verificable:* CA10 con su evidencia.
- [ ] **9b. Activar el dominio.**
  - Comprar el dominio, configurarlo en Cloudflare y pasar el servidor de la tienda a `letsencrypt` (guía C). Luego, en un equipo limpio, instalación desde cero con dominio (B + C), cronometrada; correr T19 con `PERF_FACTOR=1` en el servidor; simulacro de restauración en otro equipo.
  - *Verificable:* CA1, CA3 y CA4 con su evidencia. F10 no se cierra sin este paso.
- [ ] **10. UAT y cierre.**
  - `docs/uat/checklist.md`, sesión con el cliente, corrección de hallazgos, firma; `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 21)

"int" corre contra `postgres-test` con `app.inject`. "smoke" y "e2e" corren con Playwright contra el stack de producción de `docker-compose.e2e.yml` (modo local). "ops" son scripts de shell que corre la CI (job **backup**) y que también se pueden correr a mano.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `api` · `core/config.test.ts` | Defaults de `DOCS_ENABLED` según `NODE_ENV` y de los límites; con `NODE_ENV=production`: `COOKIE_SECURE=false`, `TRUST_PROXY=false` o el `JWT_SECRET` de `.env.example` → error que nombra la variable; una config de producción completa es válida. |
| T2 | `int` · `hardening-rate-limit.int.test.ts` | Con límites reducidos en el test: un usuario autenticado recibe 429 `RATE_LIMITED` con `Retry-After` al pasar su límite, mientras otro usuario desde la **misma IP** sigue con 200; sin autenticar, el límite es por IP; `/api/v1/health` nunca da 429; los límites de login de F2 siguen. |
| T3 | `int` · `hardening-routes.int.test.ts` | Recorre todas las rutas registradas: las `public` son exactamente `GET /health`, `POST /auth/login`, `POST /auth/refresh` y `POST /auth/logout`; las `authenticated` son exactamente la lista cerrada de §3.5; todas las demás declaran un permiso que existe en `PERMISSIONS`; ninguna ruta de `/api/v1` queda sin `security` en Swagger salvo las públicas. |
| T4 | `int` · `hardening-docs.int.test.ts` | Con `DOCS_ENABLED=false`, `/api/docs` y `/api/docs/json` → 404; con `true`, 200 (también con `NODE_ENV=production`). |
| T5 | `smoke` · `e2e/smoke/tls.spec.ts` | `http://` redirige con 301 a `https://`; la respuesta HTTPS (modo local) lleva `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` con `camera=(self)` y la CSP de §3.4; TLS 1.1 se rechaza. |
| T6 | `smoke` · `e2e/smoke/cache.spec.ts` | Un archivo de `/assets/` tiene `immutable`; `index.html`, `sw.js` y `manifest.webmanifest` tienen `no-cache`; una ruta de la SPA (`/pos`) devuelve `index.html`; `/uploads/no-existe.webp` → 404 (no la SPA); una imagen subida se sirve con `image/webp`, caché de 30 días y `nosniff`; las respuestas de texto vienen con gzip. |
| T7 | `smoke` · `e2e/smoke/proxy.spec.ts` | `GET /api/v1/health` a través de Nginx → 200 con `database: 'ok'`; un cuerpo de 12 MiB + 1 a `/api/v1/uploads/product-images` → 413 de Nginx; `/api/docs` sin credenciales → 401 y con las del `htpasswd` de prueba → 200; la API registra la IP del cliente desde `X-Forwarded-For` (log o `AuditLog` del login). |
| T8 | `smoke` · `e2e/smoke/compose.spec.ts` | `docker compose config` del archivo de producción: solo `nginx` publica puertos (80 y 443); todos los servicios tienen `restart`, `TZ` y rotación de logs; las imágenes tienen etiqueta fija; `api` corre sin `root`. |
| T9 | `smoke` · `e2e/smoke/startup.spec.ts` | Con volúmenes vacíos, `api` aplica las migraciones al arrancar y queda `healthy`; `docker compose run --rm api node dist/prisma/seed.js` crea el Propietario y el Administrador, y una segunda corrida no cambia nada; `node dist/scripts/owner-reset-password.js` imprime una contraseña con la que se puede entrar (y obliga a cambiarla). |
| T10 | `smoke` · `e2e/smoke/certs.spec.ts` | **Modo local:** Nginx sirve el certificado de `infra/certs` (se compara la huella), no envía HSTS y `docker compose ps` no tiene `certbot`; sin el archivo de certificado, `nginx` termina con código 1 y el mensaje con `pnpm dev:certs`; `TLS_MODE=otro` → código 1 con el nombre de la variable. **`letsencrypt`:** sin certificado en `certs`, Nginx arranca con el autofirmado; al colocar uno nuevo en el volumen y recargar, Nginx lo sirve; la configuración de `certbot` usa DNS-01 con `cloudflare.ini` y `APP_DOMAIN` (línea de comando renderizada). |
| T11 | `ops` · `infra/backup/test/backup.test.sh` | `backup-now` crea `.dump`, `-uploads.tar.gz` y sus `.sha256` en `backups` y en el directorio externo; con archivos de más de 14 días (local) y 30 (externo), la rotación los borra y deja los recientes; con el directorio externo de solo lectura, el respaldo local se hace y el healthcheck queda `unhealthy` al simular 26 h sin copia externa. |
| T12 | `ops` · `infra/scripts/test/restore.test.sh` | Con el seed de demo, una venta cobrada y una imagen subida: respaldo → borrar los volúmenes → levantar → `restore.sh --yes <sello>` → las cuentas de `sale`, `product_variant`, `stock_location` e `inventory_movement` coinciden con las de antes, la imagen tiene el mismo SHA-256 y se puede iniciar sesión con el usuario de antes. Un `.sha256` alterado hace fallar la restauración sin tocar la BD. |
| T13 | `e2e` · `e2e/flows/auth.spec.ts` | (mobile y desktop) Inicio de sesión de un usuario con `mustChangePassword`, cambio obligatorio, navegación por el menú según permisos y cierre de sesión; tras recargar, la sesión se recupera por el refresh. |
| T14 | `e2e` · `e2e/flows/products.spec.ts` | (desktop) Alta de un producto con variantes de talla y color, imagen y precio por variante; aparece en el catálogo y en "Buscar"; se imprime su etiqueta (`window.print` interceptado). |
| T15 | `e2e` · `e2e/flows/warehouse.spec.ts` | (mobile) Ubicar mercancía nueva escaneando rack y variante (tecleo HID), reubicar una unidad a otro rack y verla en el mapa y en el kardex con el movimiento correcto. |
| T16 | `e2e` · `e2e/flows/sale.spec.ts` | Venta completa: un vendedor en `mobile` atiende y agrega dos productos ("Carrito #1"); un cajero en `desktop` abre caja, busca el carrito #1, verifica las piezas, cobra en efectivo con cambio y obtiene el ticket con folio `S1-000001` (impresión interceptada); el stock del rack bajó. |
| T17 | `e2e` · `e2e/flows/cash-close.spec.ts` | (desktop) Un Gerente cancela una venta con motivo; el corte ciego pide el efectivo contado y después muestra esperado y diferencia, sin contar la venta cancelada. |
| T18 | `e2e` · `e2e/flows/reports.spec.ts` | (desktop) El reporte de hoy muestra las ventas de T16–T17 (la cancelada aparte) y exporta un `.xlsx` que se descarga con el nombre esperado. |
| T19 | `int` · `performance-volume.int.test.ts` | Con `seed:volume` (§3.8): las 5 consultas cumplen sus umbrales (× `PERF_FACTOR`) con 5 clientes en paralelo; `EXPLAIN` de cada una no tiene *Seq Scan* sobre `sale`, `product_variant`, `rack` ni `stock_location`; `seed:volume` con `NODE_ENV=production` termina con código 1. |
| T20 | `e2e` · `e2e/flows/pwa.spec.ts` | (mobile) En el stack de producción, el `manifest.webmanifest` es válido (nombre, íconos, `standalone`), el service worker se registra, y ninguna petición de la app viola la CSP (sin eventos `securitypolicyviolation` en una sesión que recorre login, POS y almacén). |
| T21 | `smoke` · `e2e/smoke/tls-mode-switch.spec.ts` | Con el stack en modo local, seed de demo, una venta cobrada y una imagen subida: cambiar a `TLS_MODE=letsencrypt` con `COMPOSE_PROFILES=letsencrypt` (con un certificado de prueba en el volumen `certs` y `certbot` en modo de prueba, sin llamar a Let's Encrypt) y `docker compose up -d` → la venta, el usuario y la imagen (mismo SHA-256) siguen; ahora se envía HSTS y Nginx sirve el certificado del volumen; el login funciona igual. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F9 siguen en verde.

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Despliegue desde cero en el servidor de la tienda siguiendo la guía en menos de 1 hora, con HTTPS válido desde celulares y PC sin instalar certificados. | Verificación manual cronometrada (fecha, equipo, duración y responsable en §12) + T5, T9, T10, T21 |
| CA2 | La seguridad está revisada: cabeceras y CSP, rate limit global, acceso declarado en todas las rutas, `/api/docs` protegido y límites de subida. | T1–T7, T20 |
| CA3 | El rendimiento cumple los umbrales con el doble del volumen confirmado, también en el servidor de la tienda. | T19 (CI con factor 2) + corrida en el servidor con factor 1 (§12) |
| CA4 | Restauración de un respaldo verificada, incluida una restauración en otro equipo (ensayo de la migración al VPS). | T11, T12 + simulacro manual (§12) |
| CA5 | Los flujos críticos (login, alta de producto con variantes, ubicar, reubicar, venta completa con ticket, cancelación y corte, reporte) pasan de punta a punta en móvil y escritorio. | T13–T18 |
| CA6 | La CI ejecuta lint, typecheck, tests, build, e2e y respaldo en cada PR y push a `main`/`testing`. | Ejecución en verde (enlace en §12) |
| CA7 | Existen las guías de instalación, operación y migración al VPS y el manual de usuario por módulo, revisados por el usuario. | Archivos en `docs/guides/` y `docs/manual/` + confirmación del usuario |
| CA8 | UAT firmada por el cliente. | `docs/uat/checklist.md` con firma, fecha y hallazgos resueltos |
| CA9 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F9. | Salida de los comandos en §12 |
| CA10 | Sin dominio (modo local), el stack completo se despliega en una PC con Windows y en el servidor de la tienda, y los celulares lo usan por HTTPS, con cámara e impresión, tras instalar la CA de mkcert. | T10, T21 + verificación manual en ambos equipos (fecha, equipo, celulares y responsable en §12) |

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-06 | Primer despliegue en un servidor local de la tienda; migración a un VPS con dominio propio en un futuro cercano. | Usuario (chat), plan §13.13; plan §10.2 y §13 actualizados |
| 2026-10-06 | Se compra el dominio ya: Let's Encrypt por DNS-01 con un registro que apunta a la IP local; el mismo dominio sirve para el VPS. | Usuario (chat) |
| 2026-10-06 | Volumen pequeño: hasta ~2 000 variantes, ~100 ventas al día por sucursal, ~200 racks y 5 usuarios a la vez. Las pruebas usan el doble. | Usuario (chat), plan §13.8; plan §13 actualizado |
| 2026-10-06 | CI en GitHub Actions con lint, typecheck, tests, build y e2e de Playwright. | Usuario (chat) |
| 2026-10-06 | Copia de respaldos en un disco externo o NAS de la tienda; la copia en la nube se decide al migrar al VPS. | Usuario (chat) |
| 2026-10-06 | Ubuntu Server 24.04 LTS con Docker Engine; equipo mínimo de 2 núcleos, 4 GB y SSD de 64 GB; IP fija por reserva DHCP. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | DNS del dominio en Cloudflare para el desafío DNS-01 con `certbot/dns-cloudflare`. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Rate limit global por usuario (600/min) y por IP sin autenticar (120/min), porque en el VPS la tienda compartirá IP pública. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Swagger publicado en producción detrás de autenticación básica de Nginx (`DOCS_ENABLED`). | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | La CLI `prisma` pasa a `dependencies` de `apps/api` para migrar al arrancar; los seeds se compilan para correr con `node`. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Respaldo diario a las 02:00 con 14 días en el servidor y 30 en el disco externo; aviso por healthcheck a las 26 h sin copia externa. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | gzip sin brotli; HSTS sin `includeSubDomains`; CSP con `'unsafe-inline'` solo en estilos. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Umbrales de rendimiento (catálogo 300 ms, mapa 500 ms, rack 300 ms, lookup 200 ms, reporte mensual 1 s) con factor 2 en CI. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | E2E contra el stack de producción (Nginx incluido) con un override para CI; la cámara no se prueba en e2e. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Antes de comprar el dominio, el stack completo se despliega en **modo local** para probarlo: primero en la PC de desarrollo (Windows) y después en el servidor de la tienda. | Usuario (chat); plan §8 F10 y §10.2 actualizados |
| 2026-10-06 | En modo local el certificado se genera con mkcert (como en F0) y se entra por `https://<IP-LAN>`, instalando la CA raíz en cada equipo. | Usuario (chat) |
| 2026-10-06 | `TLS_MODE=local\|letsencrypt` con `certbot` en un perfil de Compose; sin HSTS en modo local; el cambio de modo conserva los datos; los e2e y la CI corren en modo local; `dev-certs.mjs` acepta `--name` y `--ip`; `.gitattributes` con `eol=lf` para Windows. | Propuesta del agente; revisar al aprobar |
| 2026-10-07 | El usuario confirma Cloudflare como DNS del dominio y aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
