---
id: fase-00
titulo: Fundaciones
estado: COMPLETA
depende_de: []
autoriza_codigo_en:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "tsconfig.base.json"
  - "eslint.config.js"
  - ".prettierrc*"
  - ".prettierignore"
  - ".editorconfig"
  - ".nvmrc"
  - ".gitignore"
  - ".husky/**"
  - ".env.example"
  - "README.md"
  - "apps/api/**"
  - "apps/web/**"
  - "packages/shared/**"
  - "infra/docker-compose.dev.yml"
  - "infra/scripts/dev-certs.*"
fuera_de_alcance:
  - "Prisma: schema, migraciones, seed y seed de demo (F1)"
  - "Plugins transversales de F2: prisma, errorHandler, auth, permissions, branchContext, rateLimit, helmet, cookie"
  - "Chequeo de BD en /health (F2, con el plugin prisma)"
  - "Formato de error estándar { code, message, details } (F2)"
  - "Cliente HTTP con refresh, AuthProvider, design system, ScanInput, impresión y PWA (F3)"
  - "Cualquier endpoint, tabla, pantalla o lógica de negocio (F4–F9)"
  - "CI / GitHub Actions (decisión 2026-10-01: se retoma en F10)"
  - "Adminer / pgAdmin (decisión 2026-10-01)"
  - "Dockerfiles de producción, docker-compose.yml de producción, Nginx, respaldos (F10)"
  - "Protección de /api/docs con autenticación (F10)"
tests_requeridos_total: 10
tests_requeridos_en_verde: 10
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en packages/shared"
definition_of_done: cumplido
bloqueado_por: []
---

# Fase 0: Fundaciones del proyecto

## 1. Contexto y alcance

Referencias: plan §2.1 (stack), §2.2 (estructura del monorepo), §8 Fase 0, §9 (pruebas), §10.3 (health), §12 (riesgo de HTTPS y cámara).

**Objetivo:** dejar un repositorio listo para desarrollar, con calidad automatizada y un entorno reproducible. Al terminar F0:

- el monorepo pnpm compila en TypeScript estricto;
- la API Fastify responde `GET /api/v1/health` y publica Swagger;
- la SPA React muestra el estado de la API dentro de un layout *mobile-first* con placeholders por módulo;
- Jest corre en los tres paquetes;
- PostgreSQL 16 se levanta con Docker Compose;
- un celular en la LAN puede abrir la web por HTTPS (con `mkcert`) para validar desde el inicio el riesgo de la cámara (§12).

**Alcance (entra):**

1. Monorepo pnpm con `apps/api`, `apps/web` y `packages/shared`, tsconfig base estricto y referencias entre proyectos.
2. ESLint, Prettier, `.editorconfig`, `.nvmrc` (Node 24) y pre-commit con husky + lint-staged.
3. `packages/shared` con el contrato `HealthDto`, que sirve de ejemplo del patrón "contratos en shared".
4. API: configuración por env validada con Zod, logger pino, `GET /api/v1/health` y Swagger UI en `/api/docs`.
5. Web: Vite + React + Tailwind + shadcn/ui (solo init), React Router, TanStack Query, layout *mobile-first*, placeholders por módulo y componente `HealthStatus`.
6. HTTPS en desarrollo con `mkcert` y proxy `/api` en Vite (mismo origen).
7. `infra/docker-compose.dev.yml` con PostgreSQL 16.
8. Jest en `api`, `web` y `shared`.
9. `README.md` con los comandos de arranque.

**Fuera de alcance:** ver `fuera_de_alcance` en la cabecera. En particular, **no** se instala Prisma ni se crea ningún módulo de negocio. Los placeholders son "Próximamente" estáticos, sin APIs falsas (constitución §2.3).

---

## 2. Modelo de datos afectado

N/A en esta fase. PostgreSQL se levanta, pero no se crean tablas. `DATABASE_URL` se documenta en `.env.example` para que F1 la use; la API de F0 **no** la lee.

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Node | 24 LTS. `.nvmrc` = `24`; `engines.node` = `>=24 <25` en el `package.json` raíz. |
| Gestor de paquetes | pnpm, con la versión estable vigente fijada en el campo `packageManager` (corepack). |
| Nombres de paquetes | `@warehouse-manager/api`, `@warehouse-manager/web` y `@warehouse-manager/shared`. Raíz: `warehouse-manager` (`private: true`). |
| Módulos | `"type": "module"` en los tres paquetes. `api` y `shared` usan `module`/`moduleResolution` = `NodeNext`, con imports relativos que terminan en `.js`. `web` usa `bundler`. |
| TS estricto | `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`, `forceConsistentCasingInFileNames`, `skipLibCheck`. Ningún paquete relaja estas opciones. |
| Typecheck | Un `tsconfig.json` raíz (*solution*) con `references` a los tres paquetes. `pnpm typecheck` = `tsc -b`. |
| Consumo de `shared` | `shared` compila con `tsc -b` a `dist/`, y su `exports` apunta a `dist/index.js` y `dist/index.d.ts`. `api` y `web` lo declaran como `"@warehouse-manager/shared": "workspace:*"`. En Jest se resuelve al código fuente con `moduleNameMapper` (`^@warehouse-manager/shared$` → `packages/shared/src/index.ts`), así que los tests no requieren build previo. |
| Jest | Jest + `ts-jest` en los tres paquetes; la salida de los tests es CommonJS (override de tsconfig solo para tests). `moduleNameMapper` quita la extensión `.js` de los imports relativos. `web` usa `jest-environment-jsdom`, `@testing-library/jest-dom` y `identity-obj-proxy` para CSS. |
| `import.meta` | El código cubierto por tests no usa `import.meta` porque es incompatible con Jest en CJS. Solo lo usan `vite.config.ts` y el arranque (`main.tsx`). |
| Env | Un único `.env` en la raíz, sin versionar. La API lo carga con `tsx watch --env-file-if-exists=../../.env`. Vite lo lee con `loadEnv(mode, <raíz>, '')`. Docker Compose lo recibe con `--env-file .env`. |
| Logger | El de Fastify (pino). Con `NODE_ENV=development` usa el transporte `pino-pretty`; en `test` se desactiva (`logger: false` en `buildApp` de tests). |
| Swagger | `@fastify/swagger` + `@fastify/swagger-ui` con `jsonSchemaTransform` de `fastify-type-provider-zod`. UI en `/api/docs` y JSON en `/api/docs/json`. Solo se registra si `NODE_ENV !== 'production'`; la protección con autenticación queda en F10. |
| Prefijo API | Todas las rutas van bajo `/api/v1`, registradas como plugin con `prefix`. |
| Proxy dev | Vite hace proxy de `/api` → `API_PROXY_TARGET` (por defecto `http://localhost:3000`) sin reescribir la ruta. La web siempre llama a rutas relativas (`/api/v1/...`). |
| HTTPS dev | `infra/scripts/dev-certs.mjs` (Node, multiplataforma) invoca la CLI `mkcert`, que **no** es dependencia npm y se instala aparte. Genera `infra/certs/dev-cert.pem` y `dev-key.pem` para `localhost 127.0.0.1 ::1 <IP LAN>`. La IP LAN se detecta automáticamente o se pasa como argumento. `infra/certs/` está en `.gitignore`. |
| Vite server | `host: true`, puerto `5173`. Si `DEV_HTTPS_KEY` y `DEV_HTTPS_CERT` existen y apuntan a archivos legibles → `https`. Si no → HTTP, con un aviso en consola de que la cámara del celular no funcionará. |
| Breakpoint | Móvil < `md` (768 px): barra inferior. `md` en adelante: barra lateral. |
| shadcn/ui | Solo `init`: `components.json`, el helper `cn` en `src/lib/utils.ts` y los tokens CSS de Tailwind v4. No se agregan componentes en F0. |

---

## 4. Dependencias autorizadas (lista cerrada)

Versión: la última estable compatible con Node 24 al momento de instalar, fijada en `pnpm-lock.yaml`. Agregar cualquier otra dependencia requiere preguntar (constitución P2).

| Paquete del workspace | Dependencias | DevDependencies |
|---|---|---|
| Raíz | — | `typescript`, `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-config-prettier`, `globals`, `prettier`, `husky`, `lint-staged` |
| `packages/shared` | `zod` | `jest`, `ts-jest`, `@types/jest` |
| `apps/api` | `fastify`, `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui`, `zod`, `@warehouse-manager/shared` | `tsx`, `pino-pretty`, `jest`, `ts-jest`, `@types/jest` |
| `apps/web` | `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@warehouse-manager/shared` | `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `jest`, `ts-jest`, `@types/jest`, `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `identity-obj-proxy` |

Herramientas externas que **no** son dependencias npm: Docker + Docker Compose y `mkcert`.

---

## 5. Estructura de archivos resultante

```
warehouse-manager/
├── .editorconfig  .gitignore  .nvmrc  .prettierrc.json  .prettierignore  .env.example
├── .husky/pre-commit                  # pnpm lint-staged
├── eslint.config.js
├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml
├── tsconfig.base.json  tsconfig.json  # solution con references
├── README.md
├── apps/
│   ├── api/
│   │   ├── package.json  tsconfig.json  jest.config.cjs
│   │   └── src/
│   │       ├── server.ts              # arranque: loadConfig → buildApp → listen
│   │       ├── app.ts                 # buildApp(config, opts) → FastifyInstance
│   │       ├── core/
│   │       │   ├── config.ts          # loadConfig(env) con Zod
│   │       │   ├── config.test.ts     # T3, T4
│   │       │   └── swagger.ts         # registro de swagger + swagger-ui
│   │       └── modules/health/
│   │           ├── health.routes.ts
│   │           └── health.routes.test.ts   # T5, T6
│   └── web/
│       ├── package.json  tsconfig*.json  vite.config.ts  jest.config.cjs  components.json  index.html
│       └── src/
│           ├── main.tsx
│           ├── index.css              # Tailwind v4 + tokens de shadcn
│           ├── lib/utils.ts           # cn()
│           ├── app/
│           │   ├── providers.tsx      # QueryClientProvider
│           │   ├── routes.tsx         # definición de rutas (reutilizable en tests)
│           │   ├── AppLayout.tsx      # barra inferior / barra lateral
│           │   ├── AppLayout.test.tsx # T9, T10
│           │   └── modules.ts         # lista de módulos: path, label, ícono
│           ├── features/home/HomePage.tsx
│           ├── features/health/
│           │   ├── fetchHealth.ts
│           │   ├── HealthStatus.tsx
│           │   └── HealthStatus.test.tsx   # T7, T8
│           └── shared/ComingSoonPage.tsx
├── packages/shared/
│   ├── package.json  tsconfig.json  jest.config.cjs
│   └── src/
│       ├── index.ts
│       ├── health.ts                  # HealthDto
│       └── health.test.ts             # T1, T2
└── infra/
    ├── docker-compose.dev.yml
    └── scripts/dev-certs.mjs
```

---

## 6. Endpoints y esquemas Zod

### 6.1 Contrato compartido: `packages/shared/src/health.ts`

```ts
import { z } from 'zod';

export const HealthDto = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(), // ISO 8601 UTC (plan §3); API de Zod 4
});
export type HealthDto = z.infer<typeof HealthDto>;
```

`index.ts` reexporta `HealthDto`. La web y la API lo importan desde `@warehouse-manager/shared` y **no** lo redefinen (constitución P6).

### 6.2 `GET /api/v1/health`

| | |
|---|---|
| Auth | Ninguna (ruta pública de monitoreo). |
| Request | Sin parámetros. |
| Response 200 | `HealthDto`, declarado en `schema.response[200]` con el type provider de Zod. |
| Ejemplo | `{ "status": "ok", "version": "0.1.0", "uptimeSeconds": 12, "timestamp": "2026-10-01T18:00:00.000Z" }` |
| Tag Swagger | `system` |

`uptimeSeconds` = `Math.floor(process.uptime())`. `version` = `config.APP_VERSION`.

### 6.3 Documentación

- `GET /api/docs`: Swagger UI.
- `GET /api/docs/json`: documento OpenAPI 3. Incluye `info.title = "warehouse-manager API"` e `info.version = APP_VERSION`.

### 6.4 Configuración (`apps/api/src/core/config.ts`)

`loadConfig(env: NodeJS.ProcessEnv): AppConfig` valida con Zod:

| Variable | Tipo | Default |
|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` | `development` |
| `HOST` | string | `0.0.0.0` |
| `PORT` | entero 1–65535 (coerce) | `3000` |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` | `info` |
| `APP_VERSION` | string no vacío | `0.0.0` |

Si la validación falla, `loadConfig` lanza un `Error` cuyo mensaje lista cada variable inválida con su motivo. `server.ts` captura el error, lo escribe en stderr y termina con código `1`. El esquema de config es interno de la API (no es un contrato entre web y api), por eso vive en `apps/api`.

---

## 7. Pantallas (wireframe en texto)

Rutas: `/` Inicio, `/warehouse` Almacén, `/products` Productos, `/pos` POS, `/reports` Reportes, `/users` Usuarios, `/settings` Ajustes. Los textos visibles van en español.

**Móvil (< 768 px)**

```
┌──────────────────────────────┐
│ warehouse-manager            │  ← header; el nombre enlaza a "/"
├──────────────────────────────┤
│                              │
│  Inicio                      │
│  ┌────────────────────────┐  │
│  │ ● API: En línea        │  │  ← HealthStatus
│  │   versión 0.1.0        │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│ ▦     ▣     ⌁     ▤   👤  ⚙ │  ← barra inferior fija: 6 módulos
│Almac. Prod. POS  Rep. Usu Aj.│     (ícono lucide + etiqueta corta,
└──────────────────────────────┘      objetivo táctil ≥ 44 px)
```

**Escritorio (≥ 768 px)**

```
┌──────────────┬───────────────────────────────┐
│ warehouse-   │  Inicio                       │
│ manager      │  ┌─────────────────────────┐  │
│──────────────│  │ ● API: En línea  v0.1.0 │  │
│ ▦ Almacén    │  └─────────────────────────┘  │
│ ▣ Productos  │                               │
│ ⌁ POS        │                               │
│ ▤ Reportes   │                               │
│ 👤 Usuarios  │                               │
│ ⚙ Ajustes    │                               │
└──────────────┴───────────────────────────────┘
```

**Placeholder de módulo** (las 6 rutas comparten `ComingSoonPage`):

```
  <Nombre del módulo>
  Próximamente
```

Los placeholders no hacen ninguna llamada a la API.

**Estados de `HealthStatus`:**

| Estado | Texto | Indicador |
|---|---|---|
| Cargando | "Comprobando API…" | gris |
| Éxito (respuesta válida según `HealthDto`) | "API: En línea" + "versión {version}" | verde |
| Error (red, HTTP ≠ 2xx o respuesta que no cumple `HealthDto`) | "API: Sin conexión" | rojo |

El enlace del módulo activo se resalta en ambas barras (`NavLink`).

---

## 8. Reglas y casos borde

1. **API caída:** `HealthStatus` muestra el estado de error sin romper la página. En la app real, TanStack Query reintenta según su default; en los tests se configura `retry: false`.
2. **Respuesta inválida:** si `/health` responde 200 pero el body no cumple `HealthDto`, `fetchHealth` lanza un error (`HealthDto.parse`) y se muestra el estado de error.
3. **Env inválido:** la API no arranca: escribe el mensaje de validación y sale con código 1. No hay defaults silenciosos para valores mal formados.
4. **Certificados ausentes:** Vite arranca en HTTP y avisa en consola. No falla.
5. **`mkcert` no instalado:** `dev-certs.mjs` sale con código 1 y un mensaje en español que enlaza a las instrucciones de instalación del README.
6. **Ruta inexistente en la web:** se muestra un "Página no encontrada" simple, dentro del layout, con un enlace a Inicio. No se requiere test.
7. **Swagger en producción:** no se registra (`NODE_ENV=production`).
8. **Placeholders:** no contienen lógica de negocio, formularios ni llamadas a la API (constitución §2.3).

---

## 9. Scripts

**Raíz (`package.json`):**

| Script | Acción |
|---|---|
| `dev` | Compila `shared` una vez y luego corre en paralelo `shared` (`tsc -b -w`), `api` (`tsx watch`) y `web` (`vite`). |
| `build` | `pnpm -r build` (shared → api → web, en orden topológico). |
| `lint` | `eslint .` |
| `typecheck` | `tsc -b` |
| `test` | `pnpm -r test` |
| `format` | `prettier --write .` |
| `dev:db` | `docker compose -f infra/docker-compose.dev.yml --env-file .env up -d` |
| `dev:certs` | `node infra/scripts/dev-certs.mjs` |
| `prepare` | `husky` |

**lint-staged:** `*.{ts,tsx,js,cjs,mjs}` → `eslint --fix` + `prettier --write`; `*.{json,md,css,yml,yaml}` → `prettier --write`.

**Por paquete:** `build`, `test` y, donde aplique, `dev`. En `shared`, `test` corre `jest --coverage` con `coverageThreshold` global de 80 % en líneas y ramas.

---

## 10. Infraestructura de desarrollo

**`infra/docker-compose.dev.yml`**
- Servicio `postgres`: imagen `postgres:16-alpine`.
- Variables `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` tomadas del `.env`, con defaults `warehouse` / `warehouse` / `warehouse_dev`.
- Puerto `5432:5432` (solo para desarrollo).
- Volumen nombrado `pgdata`.
- Healthcheck con `pg_isready`.

**`.env.example`** (documenta todas las variables; cada una lleva un comentario en español):

```
# API
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
APP_VERSION=0.1.0
# Base de datos (docker-compose.dev.yml; la API la usará a partir de F1)
POSTGRES_USER=warehouse
POSTGRES_PASSWORD=warehouse
POSTGRES_DB=warehouse_dev
DATABASE_URL=postgresql://warehouse:warehouse@localhost:5432/warehouse_dev
# Web (Vite)
API_PROXY_TARGET=http://localhost:3000
DEV_HTTPS_KEY=infra/certs/dev-key.pem
DEV_HTTPS_CERT=infra/certs/dev-cert.pem
```

**`.gitignore`:** `node_modules/`, `dist/`, `coverage/`, `.env`, `infra/certs/`, `*.log` y `.DS_Store`.

---

## 11. TODOs (en orden, verificables)

- [x] **1. Workspace pnpm.**
  - Crear `package.json` raíz (`private`, `packageManager`, `engines`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc`, `.editorconfig`, `.gitignore`, `tsconfig.base.json` y `tsconfig.json` (solution).
  - *Verificable:* `pnpm install` termina sin errores.
- [x] **2. Calidad de código.**
  - Configurar `eslint.config.js` (flat config: `@eslint/js` + `typescript-eslint` + `react-hooks` + `eslint-config-prettier`), `.prettierrc.json`, `.prettierignore`, husky (`.husky/pre-commit`) y lint-staged.
  - *Verificable:* `pnpm lint` pasa en limpio y un commit de prueba dispara lint-staged.
- [x] **3. `packages/shared`.**
  - Crear el paquete (`package.json` con `exports` a `dist`, `tsconfig.json` compuesto), `src/health.ts`, `src/index.ts`, `jest.config.cjs` y los tests **T1–T2**.
  - *Verificable:* `pnpm --filter @warehouse-manager/shared test` en verde, con cobertura ≥ 80 %.
- [x] **4. API: configuración.**
  - Crear el paquete `apps/api`, `src/core/config.ts` y los tests **T3–T4**.
  - *Verificable:* T3–T4 en verde.
- [x] **5. API: app, health y Swagger.**
  - Crear `src/app.ts` (`buildApp`, type provider de Zod, prefijo `/api/v1`), `src/core/swagger.ts`, `src/modules/health/health.routes.ts`, `src/server.ts` y los scripts `dev`/`build`/`test`, junto con los tests **T5–T6**.
  - *Verificable:* T5–T6 en verde, y `pnpm --filter @warehouse-manager/api dev` responde en `http://localhost:3000/api/v1/health` y `/api/docs`.
- [x] **6. Web: base.**
  - Crear el paquete `apps/web` con Vite + React + TS, Tailwind v4 (`@tailwindcss/vite`), `shadcn init` (`components.json`, `cn`), `providers.tsx` (QueryClient) y `routes.tsx` (React Router).
  - *Verificable:* `pnpm --filter @warehouse-manager/web build` OK.
- [x] **7. Web: layout, placeholders y health.**
  - Crear `modules.ts`, `AppLayout.tsx`, `ComingSoonPage.tsx`, `HomePage.tsx`, `fetchHealth.ts` y `HealthStatus.tsx`, junto con los tests **T7–T10**.
  - *Verificable:* T7–T10 en verde.
- [x] **8. Proxy y HTTPS dev.**
  - En `vite.config.ts`: proxy `/api`, `host: true`, HTTPS condicional y `loadEnv` desde la raíz. Crear `infra/scripts/dev-certs.mjs`.
  - *Verificable:* con certificados, `https://localhost:5173` carga sin aviso; sin certificados, arranca en HTTP con aviso.
- [x] **9. Base de datos dev.**
  - Crear `infra/docker-compose.dev.yml` y `.env.example`.
  - *Verificable:* `pnpm dev:db` deja `postgres` en estado `healthy` (`docker compose ps`).
- [x] **10. README.**
  - Documentar: requisitos (Node 24, pnpm, Docker, mkcert); instalación; `.env`; `dev:db`; `dev`; `dev:certs`; cómo abrir la web desde el celular por IP LAN; cómo instalar la CA raíz de mkcert en Android e iOS (`mkcert -CAROOT`); `lint`/`typecheck`/`test`/`build`.
  - *Verificable:* el usuario sigue el README en limpio.
- [x] **11. Cierre.**
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en todo el monorepo; hacer la verificación manual en el celular; llenar §14 Evidencia y actualizar `tests_requeridos_en_verde`.
  - Aplicar la Definition of Done (constitución §4).

---

## 12. Tests requeridos (lista cerrada: 10)

| ID | Paquete / archivo | Caso |
|---|---|---|
| T1 | `shared` · `health.test.ts` | `HealthDto.parse` acepta un payload válido (`status: 'ok'`, versión, `uptimeSeconds` entero ≥ 0 y `timestamp` ISO). |
| T2 | `shared` · `health.test.ts` | `HealthDto.safeParse` rechaza: `status` distinto de `'ok'`, `timestamp` no ISO y `uptimeSeconds` negativo (`it.each`). |
| T3 | `api` · `config.test.ts` | `loadConfig({})` devuelve los defaults (`PORT 3000`, `HOST 0.0.0.0`, `NODE_ENV development`, `LOG_LEVEL info`, `APP_VERSION 0.0.0`), y `loadConfig({ PORT: '8080' })` convierte a número. |
| T4 | `api` · `config.test.ts` | `loadConfig` lanza error con un mensaje que nombra la variable cuando `PORT='abc'`, `PORT='70000'` o `NODE_ENV='staging'` (`it.each`). |
| T5 | `api` · `health.routes.test.ts` | `app.inject GET /api/v1/health` → 200, `content-type` JSON y body válido según `HealthDto` con `version === config.APP_VERSION`. |
| T6 | `api` · `health.routes.test.ts` | `app.inject GET /api/docs/json` → 200, y `paths` contiene `/api/v1/health` con `get`. |
| T7 | `web` · `HealthStatus.test.tsx` | Con un `fetch` simulado que devuelve un `HealthDto` válido, se muestra "API: En línea" y la versión. |
| T8 | `web` · `HealthStatus.test.tsx` | Con un `fetch` simulado que falla (rechazo de red o HTTP 500), se muestra "API: Sin conexión". |
| T9 | `web` · `AppLayout.test.tsx` | El layout muestra 6 enlaces de módulo (Almacén, Productos, POS, Reportes, Usuarios, Ajustes) con su `href` correcto. |
| T10 | `web` · `AppLayout.test.tsx` | Con un router en memoria en `/pos`, se muestra el placeholder con "POS" y "Próximamente", y no se llama a `fetch`. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4).

---

## 13. Criterios de aceptación

| # | Criterio | Evidencia esperada |
|---|---|---|
| CA1 | `pnpm dev` levanta API y web, y la web muestra el estado de `/api/v1/health`. | Verificación manual + T5 + T7 |
| CA2 | `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan en limpio. | Salida de los comandos en §14 |
| CA3 | Con certificados generados, un celular en la LAN abre `https://<IP-LAN>:5173` sin aviso de certificado (tras instalar la CA raíz) y ve "API: En línea". | Verificación manual acordada (dispositivo, SO y navegador anotados en §14) |
| CA4 | `pnpm dev:db` levanta PostgreSQL 16 en estado `healthy`. | Salida de `docker compose ps` en §14 |
| CA5 | Swagger UI accesible en `/api/docs` y documenta `GET /api/v1/health`. | T6 + verificación manual |
| CA6 | Cobertura de `packages/shared` ≥ 80 %. | Reporte de `jest --coverage` en §14 |
| CA7 | El layout se adapta: barra inferior en móvil y lateral en escritorio. | Verificación manual en ambos viewports |

---

## 14. Evidencia

*(Se completa al cerrar la fase: salidas de comandos, cobertura, verificaciones manuales con fecha, dispositivo y responsable.)*

**Avance 2026-10-07 (agente, Windows 10 + Node 24.18.1 + pnpm 12.9.1 + Docker 29.8.1):**

| Evidencia | Resultado |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` (desde limpio, sin `dist/`) | Los cuatro con código 0 (CA2). |
| Tests | 10/10 en verde: `shared` 4 (T1, T2 ×3), `api` 6 (T3, T4 ×3, T5, T6), `web` 5 (T7, T8 ×2, T9, T10). Sin `skip`/`only`/`todo`. |
| Cobertura `packages/shared` | 100 % en líneas, ramas, funciones y sentencias (CA6). |
| `pnpm dev:db` | `warehouse-manager-dev-postgres-1` · `postgres:16-alpine` · `Up (healthy)` · `0.0.0.0:5432->5432/tcp` (CA4). |
| `pnpm dev` | API en `:3000` y web en `:5173`; `GET http://127.0.0.1:5173/api/v1/health` (vía proxy de Vite) → `{"status":"ok","version":"0.1.0",…}`; sin certificados, Vite arranca en HTTP y avisa en consola (§8.4). |
| Swagger | `/api/docs` → 200 y `/api/docs/json` documenta `GET /api/v1/health` con tag `system` (CA5, parte automática). Con `NODE_ENV=production` → 404 (§8.7). |
| Env inválido | `PORT=abc` → "Configuración inválida: - PORT: …" y código 1 (§8.3). |
| `pnpm dev:certs` sin mkcert | Mensaje en español que remite al README y código 1 (§8.5). |
| API compilada | `node apps/api/dist/server.js` responde `/api/v1/health`. |

**Verificación manual 2026-10-07 (usuario, Eliu Castillo):**

| Criterio | Resultado |
|---|---|
| CA1 | Con `pnpm dev` (API en `PORT=3006`, `API_PROXY_TARGET=http://127.0.0.1:3006`), Inicio muestra "API: En línea" y la versión. |
| CA3 | Celular Android con Chrome en la misma Wi-Fi, con la CA de mkcert instalada: `https://192.168.1.69:5173` abre sin aviso de certificado y muestra "API: En línea". Hizo falta cerrar Chrome por completo tras instalar la CA (agregado al README). Certificado: SAN `localhost`, `127.0.0.1`, `::1`, `192.168.1.69`; vence el 2029-01-07. |
| CA5 | Swagger UI visible en `/api/docs` con `GET /api/v1/health`. |
| CA7 | Barra inferior en el celular y barra lateral en la PC. |
| TODO 10 | El usuario siguió el README (mkcert se instaló con winget tras `winget source update`). |
| TODO 2 | El commit de cierre de F0 dispara el pre-commit (husky + lint-staged). |
| Cierre | El usuario confirma el cierre de F0 (constitución §4.9). |

---

## 15. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-01 | Node 24 LTS. | Usuario (chat) |
| 2026-10-01 | Nombre del proyecto y scope de paquetes: `warehouse-manager` / `@warehouse-manager/*`. | Usuario (chat) |
| 2026-10-01 | F0 incluye HTTPS dev con mkcert; CI y Adminer quedan fuera. | Usuario (chat); plan §8 F0 actualizado |
| 2026-10-01 | `/health` de F0 solo reporta la API; el chequeo de BD llega en F2. | Propuesta del agente; plan §8 F0 actualizado |
| 2026-10-01 | Zod 4: `timestamp` usa `z.iso.datetime()` (reemplaza a `z.string().datetime()`, obsoleto). Spec pasa a `LISTA`. | Usuario (chat) |
| 2026-10-07 | TypeScript 6.0.3 y no 7.0: `typescript-eslint` (< 6.1) y `ts-jest` (< 7) aún no soportan TS 7, así que 6.0.x es la última estable compatible (§4). En TS 6, `types` se declara explícito en cada `tsconfig`. | Agente, al implementar (regla de §4) |
| 2026-10-07 | pnpm 12.9.1 (estable vigente). Sus scripts de instalación se controlan con `allowBuilds` en `pnpm-workspace.yaml`: se permite `esbuild` (de `tsx` y Vite) y se niegan `@parcel/watcher` y `unrs-resolver` (Jest), que traen binarios precompilados. | Agente, al implementar |
| 2026-10-07 | Jest corre con `node --experimental-vm-modules` en `api` y `web`: `@fastify/swagger-ui` (vía `content-disposition`) y `react-router` 8 son solo ESM, y Jest 30 los carga con `require(esm)` solo con esa bandera. Los tests siguen compilando a CommonJS (§3). En `web`, el setup de Jest expone `TextEncoder` de `node:util` porque jsdom no lo trae. | Agente, al implementar |
| 2026-10-07 | Archivos de soporte no listados en §5: `tsconfig.test.json` en cada paquete (override CJS de §3), `apps/web/src/test/setup.ts`, `apps/web/src/shared/NotFoundPage.tsx` (§8.6) y `tsBuildInfoFile` dentro de `dist/` para que `tsc -b` recompile si se borra `dist/`. `docs/` queda fuera de Prettier para no reformatear specs. | Agente, al implementar |
| 2026-10-07 | F0 cumple la Definition of Done y el usuario confirma el cierre. Spec pasa a `COMPLETA`. | Usuario (chat) |
