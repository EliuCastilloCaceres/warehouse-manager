---
id: fase-02
titulo: Núcleo backend
estado: BORRADOR
depende_de: [fase-01]
autoriza_codigo_en:
  - "apps/api/package.json"
  - "apps/api/tsconfig*.json"
  - "apps/api/jest.config.cjs"
  - "apps/api/src/**"
  - "apps/api/test/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/auth.ts"
  - "packages/shared/src/auth.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "packages/shared/src/health.ts"
  - "packages/shared/src/health.test.ts"
  - "packages/shared/src/uploads.ts"
  - "packages/shared/src/uploads.test.ts"
  - "apps/web/src/features/health/HealthStatus.test.tsx"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".gitignore"
  - ".env.example"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Cambios a apps/api/prisma/schema.prisma o a las migraciones (el modelo es de F1; si hiciera falta, se pregunta)"
  - "Endpoints de usuarios, ajustes, productos, almacén, inventario, POS y reportes (F4–F9)"
  - "Cualquier cambio de UI en apps/web, salvo el fixture del test de HealthStatus; el proxy /uploads de Vite es de F3"
  - "Rate limit global de la API y TRUST_PROXY de producción (F10)"
  - "Protección de /api/docs con autenticación (F10)"
  - "Limpieza de imágenes huérfanas (subidas pero nunca asociadas)"
  - "Soporte HEIC y almacenamiento S3/MinIO (solo queda la interfaz StorageService)"
  - "Bloqueo de cuentas por intentos fallidos más allá del rate limit"
tests_requeridos_total: 41
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/core/**, apps/api/src/modules/auth/** y apps/api/src/modules/inventory/**; se mantiene ≥ 80% en packages/shared"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 2: Núcleo backend

## 1. Contexto y alcance

Referencias: plan §2.4 (arquitectura del backend), §3 (convenciones), §4.3 (reglas de stock), §6 (seguridad y permisos), §8 Fase 2, §9 (pruebas) y §10.3 (observabilidad).

**Objetivo:** dejar listos los cimientos transversales que usarán todos los módulos. Al terminar F2:

- la API usa la BD a través del plugin `prisma`;
- todo error sale en el formato estándar `{ code, message, details? }`;
- cada ruta declara su acceso, y la API no arranca si alguna no lo hace;
- existe el ciclo completo de autenticación: login, refresh con rotación y detección de reutilización, logout, `me` y cambio de contraseña;
- el contexto de sucursal se resuelve por petición;
- las imágenes se suben, se validan y se convierten a WebP;
- `AuditService` registra las acciones sensibles;
- `InventoryService` aplica cada tipo de movimiento de forma atómica, con kardex y control de capacidad, también bajo concurrencia.

**Alcance (entra):**

1. Configuración extendida (BD, JWT, cookies, uploads).
2. Plugins: `prisma`, `errorHandler`, contexto de petición y logs, `auth` (JWT), control de acceso por ruta, `branchContext`, `helmet`, `cookie`, `rateLimit` (solo en rutas de auth) y `multipart`.
3. Módulo `auth` con sus 5 endpoints.
4. Chequeo de BD en `/health`.
5. Endpoints de subida de imágenes y `StorageService`.
6. `AuditService`.
7. Utilidades de paginación de la API.
8. `InventoryService`: solo el núcleo, sin endpoints.
9. Swagger con tags y esquema Bearer.

**Fuera de alcance:** ver la cabecera. **Regresión declarada de F0:** el cambio de `HealthDto` y la configuración obligan a adaptar los tests T1, T3, T4 y T5 de F0 y el fixture de T7 de web, que deben seguir en verde. Es el único cambio permitido sobre entregables de F0.

---

## 2. Decisiones técnicas

| Tema | Decisión |
|---|---|
| JWT | `@fastify/jwt`, HS256 con `JWT_SECRET` (≥ 32 caracteres). Vida de `ACCESS_TTL_MIN` (15). |
| Claims del access token | `sub` (userId), `role` (código), `perms` (`PermissionCode[]` efectivos y ordenados), `branchIds` (sucursales activas con acceso; el Administrador recibe todas las activas), `defaultBranchId` (o `null`) y `mcp` (`mustChangePassword`). Decisión del usuario: los permisos viajan en el token. |
| Permisos efectivos | Permisos del rol ∪ permisos extra del usuario, sin duplicados, ordenados y filtrados al catálogo de `shared`. Los calcula `effectivePermissions()`. |
| Refresh token | 32 bytes aleatorios en base64url. En BD se guarda su SHA-256 (hex). Cookie `wm_rt`: `httpOnly`, `secure = COOKIE_SECURE`, `sameSite: 'strict'`, `path: '/api/v1/auth'` y `maxAge = REFRESH_TTL_DAYS`. |
| Vencimiento del refresh | Ventana deslizante: cada token nuevo vence en `now + REFRESH_TTL_DAYS`. |
| Rotación | En una transacción: `UPDATE refresh_token SET revoked_at = now(), replaced_by_id = :nuevo WHERE id = :viejo AND revoked_at IS NULL`. Si no afecta ninguna fila (otra petición ya rotó el token), se trata como reutilización. |
| Reutilización | Un token revocado **con** `replacedById`, o una rotación perdida, revoca toda la familia, registra `auth.refresh_reused` en el audit y responde 401 `AUTH_REFRESH_REUSED`. Un token revocado **sin** `replacedById` (por logout o `revokeAllForUser`) responde 401 `AUTH_REFRESH_INVALID`. No hay periodo de gracia: la SPA serializa el refresh entre pestañas (F3). |
| Comprobación de `Origin` | En `POST /auth/refresh`, `/auth/logout` y `/auth/change-password`: si llega `Origin` y su host (`host:puerto`) no coincide con el header `Host` → 403 `AUTH_ORIGIN_FORBIDDEN`. Sin `Origin` se permite (clientes que no son navegador; la cookie es `SameSite=Strict`). |
| Login sin enumeración de usuarios | Si el usuario no existe o está inactivo, se verifica igual contra un hash argon2id ficticio calculado al arrancar. Usuario inexistente, inactivo o con contraseña incorrecta dan la misma respuesta: 401 `AUTH_INVALID_CREDENTIALS`, "Usuario o contraseña incorrectos". |
| Control de acceso | Cada ruta bajo `/api/v1` declara `config.access: 'public' \| 'authenticated' \| { permission: PermissionCode }`. Un hook `onRoute` lanza un error al registrar una ruta sin esa declaración. Un `preHandler` global verifica el JWT, luego `mcp` (salvo que la ruta declare `config.allowDuringPasswordChange: true`) y luego el permiso. |
| Contexto de sucursal | Las rutas con `config.branchScoped: true` obtienen `request.branchId`, resuelto así: (1) el header `X-Branch-Id` (UUID válido, si no 400 `VALIDATION_ERROR`) debe estar en `branchIds`, si no 403 `BRANCH_FORBIDDEN`; (2) sin header, se usa `defaultBranchId`, o la única sucursal si solo hay una; (3) si no hay ninguna, 400 `BRANCH_REQUIRED`. En F2 solo la usan las rutas de prueba; los módulos la usan desde F4. |
| Inyección en `buildApp` | `buildApp(config, deps?)` acepta `{ prisma?, storage?, logger?, registerExtra? }`. `registerExtra(app)` permite que **solo los tests** registren rutas de prueba (acceso, sucursal, errores). |
| Rate limit | `@fastify/rate-limit` con `global: false`. Login: 5/min por `ip + username`. Refresh: 30/min por ip. Change-password: 5/min por `userId`. Respuesta 429 `RATE_LIMITED`. El límite global queda en F10. |
| Helmet | `@fastify/helmet` con `contentSecurityPolicy: false`, porque la API solo sirve JSON y Swagger UI; la CSP de la SPA se configura en Nginx en F10. Sin CORS: todo se sirve desde el mismo origen. |
| Logs | `genReqId`: usa el `x-request-id` entrante si es un UUID; si no, genera `randomUUID()`. El id se devuelve en el header `x-request-id`. Tras autenticar, `request.log` se reemplaza por un hijo con `userId`. Se ocultan (`redact`) `authorization`, `cookie` y `set-cookie`. |
| `TRUST_PROXY` | `false` por defecto. Con `true`, Fastify usa `X-Forwarded-For` para `request.ip`. Su valor de producción se define en F10. |
| Uploads | `@fastify/multipart` con `fileSize` de 10 MiB y 1 archivo. El tipo se valida **por contenido** con `sharp().metadata()`: solo `jpeg`, `png` y `webp`. Pipeline: `rotate()` (EXIF) → `resize` con lado mayor 1600 (`fit: 'inside'`, `withoutEnlargement`) → `webp({ quality: 80 })`. Miniatura: lado mayor 400, `quality 75`. `limitInputPixels` de 50 000 000. Se descartan los metadatos. |
| Almacenamiento | Interfaz `StorageService { save(key, buffer, contentType): Promise<{ url }>; delete(key): Promise<void> }`. `LocalStorageService` escribe en `UPLOADS_DIR/{key}` (crea las carpetas) y devuelve `url = /uploads/{key}`. Si `UPLOADS_DIR` es relativo, se resuelve contra el directorio de `apps/api`. Si falla la miniatura, se borra la imagen principal. |
| `/uploads` en desarrollo | Con `NODE_ENV !== 'production'`, `@fastify/static` sirve `UPLOADS_DIR` en `/uploads/`, fuera de `/api/v1`. En producción lo sirve Nginx (F10). |
| Errores de BD | Violaciones de unique, FK o `CHECK`, vengan del cliente Prisma o de SQL crudo → 409 `CONFLICT`, con `details.constraint` (o `details.target` en P2002) cuando esté disponible. P2025 → 404 `NOT_FOUND`. |
| Transacciones de inventario | Cada método de `InventoryService` recibe un `tx` (`Prisma.TransactionClient`) y lo abre quien llama, para que F7 y F8 compongan varias operaciones en una sola transacción. Nivel `READ COMMITTED`. Las filas de rack se bloquean con `SELECT … FOR UPDATE` en orden ascendente de `id`. |
| Filas de stock en cero | `stock_location` con `quantity = 0` se **conserva**; las vistas de F7 filtran `quantity > 0`. |

---

## 3. Dependencias autorizadas (lista cerrada)

| Paquete | Dependencias |
|---|---|
| `apps/api` | `@fastify/jwt`, `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/multipart`, `@fastify/static`, `fastify-plugin` y `sharp` |

`pnpm-workspace.yaml` agrega `sharp` a `onlyBuiltDependencies`. Los tests generan sus imágenes con `sharp`, sin archivos binarios en el repo. Cualquier otra dependencia se pregunta (P2).

---

## 4. Configuración (`apps/api/src/core/config.ts`, extendido)

| Variable | Tipo | Default |
|---|---|---|
| `DATABASE_URL` | URL `postgresql://` | **requerida** |
| `JWT_SECRET` | string ≥ 32 caracteres | **requerida** |
| `ACCESS_TTL_MIN` | entero 1–60 (coerce) | `15` |
| `REFRESH_TTL_DAYS` | entero 1–30 (coerce) | `7` |
| `COOKIE_SECURE` | `'true'` \| `'false'` → boolean | `true` |
| `UPLOADS_DIR` | string no vacío | `uploads` |
| `TRUST_PROXY` | `'true'` \| `'false'` → boolean | `false` |

Las variables de F0 no cambian. `.env.example` agrega:

```
# Autenticación (genera el secreto con: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
JWT_SECRET=cambia-este-secreto-de-al-menos-32-caracteres
ACCESS_TTL_MIN=15
REFRESH_TTL_DAYS=7
# En desarrollo por HTTP sin certificados, pon false (si no, el navegador no guarda la cookie)
COOKIE_SECURE=true
# Imágenes subidas (relativo a apps/api)
UPLOADS_DIR=uploads
TRUST_PROXY=false
```

`.gitignore` agrega `apps/api/uploads/`.

---

## 5. Estructura de archivos

```
apps/api/src/
├── app.ts                         # buildApp(config, deps?)
├── server.ts
├── core/
│   ├── config.ts                  # (extendido)
│   ├── errors.ts                  # DomainError, ERROR_HTTP_STATUS, ERROR_MESSAGES
│   ├── pagination.ts              # toPrismaPage, toOrderBy, buildPage, containsInsensitive
│   ├── password.ts                # (F1)
│   ├── prisma-client.ts           # (F1)
│   ├── swagger.ts                 # (extendido: tags + bearerAuth)
│   ├── audit/audit.service.ts
│   ├── storage/storage.service.ts         # interfaz
│   ├── storage/local-storage.service.ts
│   └── plugins/
│       ├── prisma.ts
│       ├── errorHandler.ts
│       ├── requestContext.ts      # genReqId, x-request-id, logger hijo con userId
│       ├── security.ts            # helmet + cookie + rate-limit (global: false)
│       ├── auth.ts                # @fastify/jwt + decoración request.auth
│       ├── access.ts              # onRoute (exige config.access) + preHandler (JWT, mcp, permiso)
│       └── branchContext.ts
└── modules/
    ├── health/health.routes.ts    # (extendido)
    ├── auth/
    │   ├── auth.routes.ts
    │   ├── auth.service.ts
    │   ├── auth.repository.ts
    │   ├── tokens.ts              # claims, generateRefreshToken, hashRefreshToken
    │   └── permissions.ts         # effectivePermissions
    ├── uploads/
    │   ├── uploads.routes.ts
    │   └── image.processor.ts
    └── inventory/
        ├── inventory.service.ts
        ├── inventory.repository.ts   # SQL crudo: bloqueos, UPDATE condicionales, upserts
        └── inventory.types.ts
```

Los tests unitarios van junto a cada archivo. Los de integración, en `apps/api/test/integration/**` (*project* `integration` de F1). Las rutas de prueba (acceso, sucursal y errores) viven en `apps/api/test/integration/helpers/testRoutes.ts` y se registran con `registerExtra`.

---

## 6. Contratos en `packages/shared`

### 6.1 `errors.ts` (se amplía `ErrorCode`)

Códigos nuevos: `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_REUSED`, `AUTH_PASSWORD_CHANGE_REQUIRED`, `AUTH_PASSWORD_INCORRECT`, `AUTH_ORIGIN_FORBIDDEN`, `BRANCH_FORBIDDEN`, `BRANCH_REQUIRED`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `DB_UNAVAILABLE`, `RACK_INACTIVE`, `INVENTORY_CROSS_WAREHOUSE` e `INVENTORY_INVALID_OPERATION`.

```ts
export const ValidationIssue = z.object({ path: z.string(), message: z.string() });
// details de VALIDATION_ERROR: z.array(ValidationIssue)
```

**Estado HTTP por código** (`ERROR_HTTP_STATUS` en `apps/api/src/core/errors.ts`, un `Record` exhaustivo):

| HTTP | Códigos |
|---|---|
| 400 | `VALIDATION_ERROR`, `AUTH_PASSWORD_INCORRECT`, `BRANCH_REQUIRED` |
| 401 | `UNAUTHENTICATED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_REUSED` |
| 403 | `FORBIDDEN`, `AUTH_PASSWORD_CHANGE_REQUIRED`, `AUTH_ORIGIN_FORBIDDEN`, `BRANCH_FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `STOCK_INSUFFICIENT`, `RACK_CAPACITY_EXCEEDED`, `RACK_INACTIVE`, `INVENTORY_CROSS_WAREHOUSE`, `INVENTORY_INVALID_OPERATION` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `DB_UNAVAILABLE` |

`ERROR_MESSAGES` define un mensaje por defecto en español para cada código; un `DomainError` puede sobrescribirlo.

### 6.2 `health.ts` (cambio)

`HealthDto` agrega `database: z.literal('ok')`. Si la BD falla, la respuesta es 503 `ApiErrorDto` (`DB_UNAVAILABLE`), no un `HealthDto`.

### 6.3 `auth.ts` (nuevo)

```ts
export const PasswordPolicy = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(128);

export const LoginInput = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(128),            // sin política: no revela reglas
});

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordPolicy,
}).refine((v) => v.newPassword !== v.currentPassword, {
  path: ['newPassword'], message: 'La nueva contraseña debe ser distinta de la actual',
});

export const MeDto = z.object({
  user: z.object({
    id: Uuid, username: z.string(), fullName: z.string(), mustChangePassword: z.boolean(),
    role: z.object({ code: z.string(), name: z.string() }),
  }),
  permissions: z.array(PermissionCode),
  branches: z.array(z.object({ id: Uuid, code: z.string(), name: z.string(), isDefault: z.boolean() })),
});

export const AuthSessionDto = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),          // segundos
  me: MeDto,
});
```

### 6.4 `uploads.ts` (nuevo)

```ts
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const ImageUploadDto = z.object({
  url: z.string().startsWith('/uploads/'),
  thumbUrl: z.string().startsWith('/uploads/'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
```

---

## 7. Endpoints

Todos van bajo `/api/v1`. Las respuestas de error son `ApiErrorDto`. Los textos que verá el usuario van en español.

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /health` | `public` | — | 200 `HealthDto` · 503 `DB_UNAVAILABLE` |
| `POST /auth/login` | `public`, rate limit 5/min (ip+username) | `LoginInput` | 200 `AuthSessionDto` + cookie `wm_rt` · 400 · 401 `AUTH_INVALID_CREDENTIALS` · 429 |
| `POST /auth/refresh` | `public` + Origin, rate limit 30/min (ip) | cookie `wm_rt` | 200 `AuthSessionDto` + cookie nueva · 401 `AUTH_REFRESH_INVALID` / `AUTH_REFRESH_REUSED` (limpia la cookie) · 403 `AUTH_ORIGIN_FORBIDDEN` · 429 |
| `POST /auth/logout` | `public` + Origin | cookie `wm_rt` (opcional) | 204 (idempotente; revoca solo ese token y limpia la cookie) · 403 `AUTH_ORIGIN_FORBIDDEN` |
| `GET /auth/me` | `authenticated`, `allowDuringPasswordChange` | — | 200 `MeDto` (leído de la BD, no del token) · 401 (también si el usuario ya está inactivo) |
| `POST /auth/change-password` | `authenticated`, `allowDuringPasswordChange` + Origin, rate limit 5/min (userId) | `ChangePasswordInput` | 200 `AuthSessionDto` + cookie nueva · 400 `VALIDATION_ERROR` / `AUTH_PASSWORD_INCORRECT` · 401 · 429 |
| `POST /uploads/product-images` | `{ permission: 'products.manage' }` | multipart, campo `file` | 201 `ImageUploadDto` · 400 (sin archivo) · 403 · 413 · 415 |
| `POST /uploads/branch-images` | `{ permission: 'settings.branch' }` | multipart, campo `file` | Igual que el anterior; se guarda en `branch/` |

**Efectos de cada ruta:**

- **Login exitoso:**
  - actualiza `lastLoginAt`;
  - crea un refresh de una familia nueva y pone la cookie;
  - registra `auth.login` en el audit (`payload: { userAgent }`, sin credenciales).
- **Refresh exitoso:**
  - rota el token;
  - vuelve a calcular los claims desde la BD, así que los cambios de permisos se aplican aquí;
  - si el usuario está inactivo, revoca el token y responde 401 `AUTH_REFRESH_INVALID`.
- **Change-password**, en una sola transacción:
  - verifica la contraseña actual (si no coincide, `AUTH_PASSWORD_INCORRECT`);
  - guarda el hash nuevo y pone `mustChangePassword = false`;
  - revoca **todas** las familias del usuario;
  - crea una familia nueva, pone su cookie y devuelve un `AuthSessionDto` nuevo;
  - registra `auth.password_change` en el audit.
- **Uploads:** el archivo se guarda en `{entity}/{uuid}.webp` y `{entity}/{uuid}.thumb.webp`, con `entity` = `product` o `branch`.

`AuthService.revokeAllForUser(userId, tx?)` revoca todos los refresh activos del usuario. Queda expuesto para F4 (desactivar y restablecer contraseña).

---

## 8. `InventoryService` (núcleo, sin endpoints)

Firma común: `método(tx, input)`. Todo `input` incluye `userId` y, opcionalmente, `note` y `reference: { type: InventoryReferenceType, id }`. `quantity` se valida con `Quantity` de `shared`. Cada método inserta su `InventoryMovement` y devuelve `{ movement, balances: { rackId, quantity, reservedQty }[] }`.

| Método | Movimiento | Regla |
|---|---|---|
| `receive({ type: 'INITIAL_LOAD' \| 'PUTAWAY' \| 'ADJUSTMENT_IN', variantId, rackId, quantity, overrideCapacity? })` | `type` → `toRack` | Destino activo. Capacidad (salvo staging). Upsert `quantity += n`. `ADJUSTMENT_IN` exige `note`. |
| `relocate({ variantId, fromRackId, toRackId, quantity, overrideCapacity? })` | `RELOCATE` | Mismo almacén, racks distintos y destino activo. Toma unidades **disponibles** del origen (`quantity - reserved_qty >= n`). Capacidad del destino. |
| `moveReservedToStaging({ variantId, fromRackId, quantity })` | `TO_STAGING` → rack de staging del mismo almacén | Toma unidades **reservadas** del origen (`quantity -= n`, `reserved_qty -= n`, con `reserved_qty >= n`). Staging recibe `quantity += n`. |
| `pick({ variantId, rackId, quantity })` | `PICK` | `reserved_qty += n` si `quantity - reserved_qty >= n`. |
| `release({ variantId, rackId, quantity })` | `RETURN_TO_RACK` | `reserved_qty -= n` si `reserved_qty >= n`. |
| `sell({ variantId, rackId, quantity })` | `SALE` | `quantity -= n` y `reserved_qty -= n` si `reserved_qty >= n`. |
| `returnCancelledSaleToStaging({ variantId, warehouseId, quantity })` | `SALE_CANCEL` → staging | Staging del almacén indicado, `quantity += n`. |
| `adjustOut({ variantId, rackId, quantity })` | `ADJUSTMENT_OUT` | Exige `note`. Solo unidades disponibles. |

**Errores:**

| Caso | Error |
|---|---|
| Rack o variante inexistente | `NOT_FOUND` |
| Destino inactivo | `RACK_INACTIVE` |
| Origen y destino en almacenes distintos | `INVENTORY_CROSS_WAREHOUSE` |
| Mismo rack; staging inexistente o inactivo; reservadas insuficientes (`release`, `sell`, `moveReservedToStaging`) | `INVENTORY_INVALID_OPERATION` |
| Disponibles insuficientes (`relocate`, `pick`, `adjustOut`) | `STOCK_INSUFFICIENT`, con `details: { available, requested }` |
| Capacidad excedida sin `overrideCapacity` | `RACK_CAPACITY_EXCEEDED`, con `details: { rackId, locationCode, capacity, occupied, requested }` |
| Falta `note` en un ajuste | `VALIDATION_ERROR` (`path: 'note'`) |

**Capacidad:**
1. Bloquear el rack destino (`FOR UPDATE`; en `relocate`, ambos racks en orden de id).
2. `occupied = Σ quantity` del rack.
3. Si `occupied + n > capacity_units` y el rack no es de staging:
   - con `overrideCapacity` → `capacityOverridden = true`;
   - si no → error.

`overrideCapacity` significa "el usuario tiene `inventory.override_capacity` y lo confirmó". Lo decide la ruta (F7); el servicio no consulta permisos.

---

## 9. Reglas y casos borde

1. **Token vencido o con firma inválida:** 401 `UNAUTHENTICATED`. La SPA refresca ante cualquier 401 (F3).
2. **`AUTH_PASSWORD_INCORRECT` es 400, no 401:** así la SPA no intenta refrescar.
3. **Usuario desactivado:**
   - no puede iniciar sesión (401 genérico) ni refrescar (`AUTH_REFRESH_INVALID`);
   - su access token sigue sirviendo hasta que vence (≤ 15 min, decisión del usuario);
   - `GET /auth/me` responde 401.
4. **Dos refresh simultáneos con la misma cookie:** uno gana y el otro revoca la familia (`AUTH_REFRESH_REUSED`). Es el comportamiento estricto acordado; F3 lo evita con Web Locks.
5. **Cookie sin `Secure` en HTTP:** con `COOKIE_SECURE=true` y la SPA servida por HTTP, el navegador descarta la cookie. Se documenta en el README y en `.env.example`.
6. **Imagen engañosa:** un archivo `.jpg` que en realidad es texto o GIF responde 415. Un archivo de más de 10 MiB responde 413. El límite de píxeles evita "bombas" de descompresión.
7. **Error inesperado:** responde 500 `INTERNAL_ERROR` con un mensaje genérico. El detalle (con `requestId`) solo va al log.
8. **Kardex:** si la transacción del llamador falla después de una operación de inventario, no queda ni stock ni movimiento.
9. **Concurrencia:** ninguna combinación de operaciones paralelas deja stock negativo, reservas mayores que la existencia ni capacidad excedida sin `overrideCapacity`. Lo garantizan las restricciones de F1 y los bloqueos de rack.

---

## 10. TODOs (en orden, verificables)

- [ ] **1. Dependencias y configuración.**
  - Instalar las dependencias de §3, extender `config.ts` (§4), `.env.example` y `.gitignore`. Adaptar T3/T4 de F0 y crear **T1–T2**.
  - *Verificable:* T1–T2 y T3/T4 de F0 en verde.
- [ ] **2. Errores.**
  - Ampliar `ErrorCode` y `ValidationIssue` en `shared`. Crear `core/errors.ts` y el plugin `errorHandler` (incluye el `notFoundHandler`). Tests **T3** y **T11**.
  - *Verificable:* T3 y T11 en verde.
- [ ] **3. Prisma y health.**
  - Crear el plugin `prisma` y aceptar `deps` en `buildApp`. Agregar el chequeo de BD en `/health` y el cambio de `HealthDto`. Adaptar T1 (shared), T5 (api) y el fixture de T7 (web) de F0. Tests **T8** (parte de health) y **T10**.
  - *Verificable:* T8, T10 y los tests de F0 en verde.
- [ ] **4. Contexto de petición y logs.**
  - Crear `requestContext` (`genReqId`, `x-request-id`, `redact`) y el test **T26**.
  - *Verificable:* T26 en verde.
- [ ] **5. Control de acceso.**
  - Crear los plugins `security`, `auth` (JWT) y `access` (`onRoute` + `preHandler`), `permissions.ts` y las rutas de prueba. Tests **T4**, **T9** y **T19**.
  - *Verificable:* T4, T9 y T19 en verde.
- [ ] **6. Contexto de sucursal.**
  - Crear el plugin `branchContext` y el test **T23**.
  - *Verificable:* T23 en verde.
- [ ] **7. Auditoría.**
  - Crear `AuditService` y el test **T29**.
  - *Verificable:* T29 en verde.
- [ ] **8. Contratos de auth.**
  - Crear `shared/auth.ts` y el test **T7**; completar **T8**.
  - *Verificable:* T7–T8 en verde.
- [ ] **9. Login.**
  - Crear `tokens.ts`, `auth.repository.ts`, el login en `auth.service.ts`/`auth.routes.ts` y su rate limit. Tests **T5**, **T12–T14** y **T22**.
  - *Verificable:* T5, T12–T14 y T22 en verde.
- [ ] **10. Refresh y logout.**
  - Implementar la rotación, la detección de reutilización, la comprobación de `Origin`, `logout` y `revokeAllForUser`. Tests **T15–T18** y **T25**.
  - *Verificable:* T15–T18 y T25 en verde.
- [ ] **11. `me` y cambio de contraseña.**
  - Implementar `GET /auth/me`, `POST /auth/change-password` y el bloqueo por `mcp`. Tests **T20**, **T21** y **T24**.
  - *Verificable:* T20, T21 y T24 en verde.
- [ ] **12. Paginación.**
  - Crear `core/pagination.ts` y el test **T6**.
  - *Verificable:* T6 en verde.
- [ ] **13. Uploads.**
  - Crear `shared/uploads.ts`, `StorageService` + `LocalStorageService`, `image.processor.ts`, las rutas y el static de desarrollo. Tests **T27–T28**.
  - *Verificable:* T27–T28 en verde.
- [ ] **14. InventoryService.**
  - Crear `inventory.repository.ts`, `inventory.service.ts` y los tests **T30–T37**.
  - *Verificable:* T30–T37 en verde.
- [ ] **15. Concurrencia.**
  - Tests **T38–T40**.
  - *Verificable:* T38–T40 en verde de forma estable (5 corridas seguidas sin fallos).
- [ ] **16. Swagger.**
  - Agregar tags y el esquema `bearerAuth`, con `security` en las rutas no públicas. Test **T41**.
  - *Verificable:* T41 en verde y `/api/docs` muestra el candado en las rutas protegidas.
- [ ] **17. README y cierre.**
  - En el README: `JWT_SECRET`, `COOKIE_SECURE` en HTTP y probar el login con Swagger/curl.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; registrar la cobertura; llenar §13 Evidencia; aplicar la Definition of Done (constitución §4).

---

## 11. Tests requeridos (lista cerrada: 41)

Los marcados con "int" corren contra `postgres-test` con `app.inject`. Para simular el paso del tiempo se falsea **solo** `Date` (`jest.useFakeTimers` con el resto en `doNotFake`).

| ID | Archivo | Caso |
|---|---|---|
| T1 | `core/config.test.ts` | Con `DATABASE_URL` y `JWT_SECRET` válidos: defaults de §4 (15, 7, `true`, `uploads`, `false`), coerción de números y `COOKIE_SECURE='false'` → `false`. |
| T2 | `core/config.test.ts` | `it.each`: lanza un error que nombra la variable si falta `DATABASE_URL`, si `JWT_SECRET` tiene 31 caracteres, si `REFRESH_TTL_DAYS=31`, si `ACCESS_TTL_MIN=0` o si `COOKIE_SECURE='si'`. |
| T3 | `core/errors.test.ts` | Cada `ErrorCode` de `shared` tiene un estado HTTP y un mensaje en español; `DomainError` se serializa a un `ApiErrorDto` válido con el estado de la tabla de §6.1. |
| T4 | `modules/auth/permissions.test.ts` | `effectivePermissions`: unión de rol y extras, sin duplicados, ordenada, descarta códigos ajenos al catálogo y respeta los 4 roles del sistema. |
| T5 | `modules/auth/tokens.test.ts` | `generateRefreshToken` produce 43 caracteres base64url y valores distintos en cada llamada; `hashRefreshToken` es SHA-256 hex determinista. |
| T6 | `core/pagination.test.ts` | `toPrismaPage({page:3,pageSize:20})` → `{skip:40,take:20}`; `toOrderBy` con orden por defecto y explícito; `buildPage` arma `{items,page,pageSize,total}`; `containsInsensitive`. |
| T7 | `shared` · `auth.test.ts` | `LoginInput` normaliza `" Admin "` → `"admin"`. `ChangePasswordInput` rechaza menos de 8 y más de 128 caracteres, y una nueva igual a la actual (con `path` en `newPassword`). Las fixtures de `MeDto` y `AuthSessionDto` son válidas y se rechazan con un permiso inexistente. |
| T8 | `shared` · `health.test.ts` / `errors.test.ts` / `uploads.test.ts` | `HealthDto` exige `database: 'ok'`; los 14 códigos nuevos existen en `ErrorCode`; `ValidationIssue` acepta `{path,message}`; `ImageUploadDto` exige el prefijo `/uploads/`. |
| T9 | `core/plugins/access.test.ts` | `buildApp` con una ruta de prueba sin `config.access` lanza un error que nombra método y URL; con `config.access` arranca. |
| T10 | `modules/health/health.routes.test.ts` + `int` · `health.int.test.ts` | Con un `prisma` simulado que falla → 503 `DB_UNAVAILABLE` (unitario). Con BD real → 200 `HealthDto` con `database: 'ok'` (integración). |
| T11 | `int` · `error-handler.int.test.ts` | `it.each` sobre rutas de prueba: body inválido → 400 `VALIDATION_ERROR` con `details[].path`; JSON mal formado → 400; `DomainError(STOCK_INSUFFICIENT)` → 409; unique duplicado (P2002) → 409 `CONFLICT` con `details.target`; `CHECK` violado por SQL crudo → 409 con `details.constraint`; `Error('x')` → 500 `INTERNAL_ERROR` sin `'x'` ni stack en el body; ruta inexistente → 404 `NOT_FOUND`. |
| T12 | `int` · `auth-login.int.test.ts` | Login correcto → 200 `AuthSessionDto` válido. La cookie `wm_rt` es `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` y `Secure` (con `COOKIE_SECURE=true`). En BD el token aparece como SHA-256 de la cookie. Se actualiza `lastLoginAt` y hay un `AuditLog` `auth.login` sin la contraseña. |
| T13 | `int` · `auth-login.int.test.ts` | Contraseña incorrecta, usuario inexistente y usuario inactivo → los tres responden 401 `AUTH_INVALID_CREDENTIALS` con el mismo `message`, sin cookie ni `AuditLog`. |
| T14 | `int` · `auth-login.int.test.ts` | El 6.º intento en un minuto (misma ip y username) → 429 `RATE_LIMITED`; otro username desde la misma ip sigue en 401/200. |
| T15 | `int` · `auth-cycle.int.test.ts` | **Ciclo del plan:** login → `GET /auth/me` 200 → `Date` +16 min → 401 `UNAUTHENTICATED` → refresh 200 (token y cookie nuevos; el viejo queda con `revokedAt` y `replacedById`) → `me` con el token nuevo 200 → reusar la cookie vieja → 401 `AUTH_REFRESH_REUSED`, toda la familia revocada (la cookie nueva también falla) y `AuditLog` `auth.refresh_reused` → login → logout 204 con la cookie limpiada → refresh con esa cookie → 401 `AUTH_REFRESH_INVALID`. |
| T16 | `int` · `auth-refresh.int.test.ts` | Sin cookie → 401 `AUTH_REFRESH_INVALID`; token vencido (`expiresAt` en el pasado) → 401; usuario desactivado → 401 y su token queda revocado. Ventana deslizante: el `expiresAt` nuevo ≈ `now + REFRESH_TTL_DAYS` (±5 s). Un permiso agregado al rol después del login aparece en los claims tras el refresh. |
| T17 | `int` · `auth-refresh.int.test.ts` | Dos refresh en paralelo con la misma cookie → exactamente un 200 y un 401 `AUTH_REFRESH_REUSED`; al final no queda ningún token activo en la familia. |
| T18 | `int` · `auth-refresh.int.test.ts` | Refresh, logout y change-password con un `Origin` cuyo host difiere de `Host` → 403 `AUTH_ORIGIN_FORBIDDEN`; con `Origin` igual o sin `Origin` → se procesan. |
| T19 | `int` · `access.int.test.ts` | Sobre rutas de prueba: sin token → 401 `UNAUTHENTICATED`; firma inválida → 401; token sin el permiso → 403 `FORBIDDEN` con `details.permission`; con el permiso → 200; ruta `authenticated` con cualquier token válido → 200. |
| T20 | `int` · `auth-password.int.test.ts` | Usuario con `mustChangePassword`: `GET /auth/me` 200, ruta protegida 403 `AUTH_PASSWORD_CHANGE_REQUIRED`, logout 204. |
| T21 | `int` · `auth-password.int.test.ts` | Contraseña actual incorrecta → 400 `AUTH_PASSWORD_INCORRECT`; nueva igual a la actual → 400 `VALIDATION_ERROR`. Éxito → 200 `AuthSessionDto` con `mustChangePassword: false`; el refresh de **otra** sesión del mismo usuario → 401; la cookie nueva sí refresca; el token nuevo accede a la ruta protegida; la nueva contraseña verifica con argon2; hay `AuditLog` `auth.password_change`. |
| T22 | `int` · `auth-claims.int.test.ts` | Admin: `branchIds` = todas las sucursales activas. Usuario `SELLER` con 1 permiso extra: `perms` = 7 + 1. Una sucursal inactiva no aparece. `defaultBranchId` corresponde a `isDefault`; `mcp` refleja `mustChangePassword`. |
| T23 | `int` · `branch-context.int.test.ts` | Ruta de prueba `branchScoped`: sin header → sucursal por defecto; con una sola sucursal y sin default → esa; header permitido → esa; header no permitido → 403 `BRANCH_FORBIDDEN`; header no UUID → 400 `VALIDATION_ERROR`; 2 sucursales sin default y sin header → 400 `BRANCH_REQUIRED`. |
| T24 | `int` · `auth-me.int.test.ts` | `me` devuelve el `MeDto` leído de la BD (incluye un permiso extra agregado después del login). Usuario desactivado con un token aún vigente → 401. |
| T25 | `int` · `auth-revoke.int.test.ts` | `revokeAllForUser(A)` revoca todos los tokens activos de A (de varias familias) y no toca los de B. |
| T26 | `int` · `request-context.int.test.ts` | La respuesta trae `x-request-id` (se respeta un UUID entrante y se genera uno si el entrante no es válido). En los logs capturados de una petición autenticada aparece `userId`, y `authorization` y `cookie` salen ocultos. |
| T27 | `int` · `uploads.int.test.ts` | JPEG de 3000×2000 generado con sharp → 201 `ImageUploadDto`. Los dos archivos existen en un `UPLOADS_DIR` temporal: WebP de 1600×1067 y miniatura con lado mayor 400. PNG y WebP también se aceptan. `GET` de la URL (static de desarrollo) → 200 `image/webp`. `branch-images` guarda en `branch/`. |
| T28 | `int` · `uploads.int.test.ts` | Sin `products.manage` → 403; `branch-images` sin `settings.branch` → 403; texto con extensión `.jpg` → 415; GIF → 415; 10 MiB + 1 byte → 413 `PAYLOAD_TOO_LARGE`; sin archivo → 400 `VALIDATION_ERROR`. En todos los casos de error no queda ningún archivo escrito. |
| T29 | `int` · `audit.int.test.ts` | `record` guarda `userId`, `action`, `entity`, `entityId`, `payload` e `ip`. Dentro de un `tx` que luego falla, no queda la fila. |
| T30 | `int` · `inventory-receive.int.test.ts` | `INITIAL_LOAD` crea el `stock_location` y su movimiento (forma `to`); un segundo `PUTAWAY` acumula; staging ignora la capacidad; rack inactivo → `RACK_INACTIVE`; variante inexistente → `NOT_FOUND`; `ADJUSTMENT_IN` sin `note` → `VALIDATION_ERROR`. |
| T31 | `int` · `inventory-capacity.int.test.ts` | Exceder la capacidad → `RACK_CAPACITY_EXCEEDED` con los `details` de §8 y sin escrituras. Con `overrideCapacity` → OK y `capacityOverridden: true`. Justo en el límite → OK. |
| T32 | `int` · `inventory-relocate.int.test.ts` | `relocate` mueve unidades disponibles; con unidades reservadas en el origen, pedir más que las disponibles → `STOCK_INSUFFICIENT` con `available`; distinto almacén → `INVENTORY_CROSS_WAREHOUSE`; mismo rack → `INVENTORY_INVALID_OPERATION`; destino lleno → `RACK_CAPACITY_EXCEEDED`; desde un origen inactivo → OK. |
| T33 | `int` · `inventory-pos.int.test.ts` | `pick` reserva; un `pick` mayor que lo disponible → `STOCK_INSUFFICIENT`; `release` libera; un `release` mayor que lo reservado → `INVENTORY_INVALID_OPERATION`; `sell` descuenta existencia y reserva. Los movimientos llevan `reference` `CART`/`SALE`. |
| T34 | `int` · `inventory-staging.int.test.ts` | `moveReservedToStaging` mueve unidades reservadas al rack `STG-01-01` del mismo almacén; `returnCancelledSaleToStaging` suma en staging con `SALE_CANCEL`; un almacén sin staging activo → `INVENTORY_INVALID_OPERATION`. |
| T35 | `int` · `inventory-adjust.int.test.ts` | `adjustOut` exige `note`, no toma unidades reservadas (`STOCK_INSUFFICIENT`) y descuenta las disponibles. |
| T36 | `int` · `inventory-atomicity.int.test.ts` | Un `receive` dentro de un `$transaction` que luego lanza un error no deja `stock_location` ni `inventory_movement`. |
| T37 | `int` · `inventory-kardex.int.test.ts` | Tras una secuencia fija de 12 operaciones, reproducir los movimientos del kardex (función de test que aplica la tabla de efectos de F1 §4.5) da exactamente `quantity` y `reserved_qty` de cada `stock_location`. |
| T38 | `int` · `inventory-concurrency.int.test.ts` | Con 1 unidad disponible, 2 `pick` en paralelo (transacciones separadas) → uno OK y uno `STOCK_INSUFFICIENT`; `reserved_qty = 1`. |
| T39 | `int` · `inventory-concurrency.int.test.ts` | Rack con capacidad 10 y 6 ocupadas: 2 `receive` de 3 en paralelo → uno OK y uno `RACK_CAPACITY_EXCEEDED`; ocupación final 9. |
| T40 | `int` · `inventory-concurrency.int.test.ts` | 10 pares de `relocate` A→B y B→A en paralelo terminan sin errores de deadlock (solo OK o `STOCK_INSUFFICIENT`), y el total A+B se conserva. |
| T41 | `int` · `swagger.int.test.ts` | `/api/docs/json` declara `components.securitySchemes.bearerAuth`; las rutas `/api/v1/auth/*` tienen el tag `auth`; las rutas no públicas llevan `security`; `/api/v1/health` no. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests T1, T3, T4 y T5 de F0, y T7 de web, se adaptan y siguen en verde (regresión declarada en §1).

---

## 12. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Ciclo completo: login → acceso con token → expiración → refresh → la reutilización del refresh viejo revoca la familia → logout. | T15 |
| CA2 | Un usuario sin permiso recibe 403 con `code` estable. Un usuario desactivado no puede iniciar sesión ni refrescar. | T19, T13, T16 |
| CA3 | Con `mustChangePassword`, la API solo permite `me`, cambio de contraseña y logout. Tras el cambio, la sesión actual sigue y las demás se cierran. | T20, T21 |
| CA4 | Ninguna operación de inventario deja stock negativo ni excede la capacidad sin autorización, tampoco en paralelo. | T31–T33, T38–T40 |
| CA5 | Cada cambio de stock deja su movimiento en el kardex dentro de la misma transacción, y el kardex reproduce el stock. | T30–T37 |
| CA6 | Las imágenes se validan por contenido y tamaño y se guardan en WebP con miniatura. | T27, T28 |
| CA7 | Todas las rutas declaran su acceso y Swagger documenta la seguridad Bearer. | T9, T41 + verificación manual en `/api/docs` |
| CA8 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0 y F1. | Salida de los comandos en §13 |
| CA9 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §13 |

---

## 13. Evidencia

*(Se completa al cerrar la fase.)*

---

## 14. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-02 | Los permisos viajan en el access token (`perms`, `branchIds`); un cambio tarda hasta 15 min en surtir efecto. | Usuario (chat); plan §6.1 |
| 2026-10-02 | El servidor hace cumplir `mustChangePassword` (solo `me`, cambio de contraseña y logout). | Usuario (chat); plan §6.1 |
| 2026-10-02 | El cambio de contraseña revoca todas las familias y emite una sesión nueva. | Usuario (chat); plan §6.1 |
| 2026-10-02 | Refresh con ventana deslizante de 7 días (máx. 30). | Usuario (chat); plan §6.1 |
| 2026-10-02 | Sin `X-Branch-Id` se usa la sucursal por defecto o la única. | Usuario (chat); plan §6.2 |
| 2026-10-02 | Uploads de hasta 10 MB, JPEG/PNG/WebP → WebP 1600 + miniatura 400, sin HEIC. | Usuario (chat); plan §8 F2 |
| 2026-10-02 | En el audit de auth: login exitoso, cambio de contraseña y reutilización de refresh. | Usuario (chat); plan §8 F2 |
| 2026-10-02 | Detección de reutilización estricta; la SPA serializa el refresh entre pestañas con Web Locks. | Usuario (chat); plan §6.1 y §8 F3 |
| 2026-10-02 | `config.access` obligatorio por ruta, verificado con `onRoute`; `allowDuringPasswordChange` y `branchScoped` como opciones de ruta. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | Claims adicionales `defaultBranchId` y `mcp`, para resolver la sucursal y el bloqueo sin consultar la BD. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | Rate limit solo en auth (5/min en login, 30/min en refresh, 5/min en change-password); el global queda en F10. Helmet sin CSP en la API. `TRUST_PROXY` en `false` por defecto. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | Dos rutas de upload con permiso estático (`product-images`, `branch-images`) en lugar de una con `entity` variable. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | `AUTH_PASSWORD_INCORRECT` es 400 (no 401) para no disparar el refresh de la SPA. Las peticiones sin `Origin` se permiten. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | `InventoryService` recibe el `tx` de quien llama; `TO_STAGING` consume unidades reservadas y `RELOCATE`, unidades disponibles; las filas de stock en 0 se conservan. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | Se adaptan tests de F0 (T1, T3, T4, T5 y T7 de web) por el cambio de `HealthDto` y de la configuración (regresión declarada). | Propuesta del agente; revisar al aprobar |
