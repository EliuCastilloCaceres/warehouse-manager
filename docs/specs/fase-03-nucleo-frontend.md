---
id: fase-03
titulo: Núcleo frontend
estado: EN_PROGRESO
depende_de: [fase-02]
autoriza_codigo_en:
  - "apps/web/**"
  - "pnpm-lock.yaml"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Pantallas y lógica de F4–F9 (usuarios, ajustes, productos, almacén, POS, reportes); los módulos siguen como placeholder \"Próximamente\", ahora filtrados por permiso"
  - "Cualquier cambio en apps/api o packages/shared (si hiciera falta, se pregunta)"
  - "Plantillas finales de etiqueta de producto (F6), de ubicación (F7) y de ticket (F8); F3 solo entrega PrintLayout, Barcode y QrCode"
  - "Offline de datos y caché de /api o /uploads en el service worker"
  - "Impresión ESC/POS directa (post-MVP)"
  - "Guardar el access token fuera de memoria (localStorage, sessionStorage, IndexedDB o cookies legibles por JS)"
  - "Botón propio de \"Instalar app\"; se usa el flujo nativo del navegador"
  - "Selector entre varias cámaras; se usa la trasera (facingMode: environment)"
  - "E2E con Playwright y CSP de Nginx (F10)"
tests_requeridos_total: 32
tests_requeridos_en_verde: 32
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/web/src/shared/api/**, apps/web/src/features/auth/**, apps/web/src/features/branch/** y apps/web/src/shared/scan/** (excepto el adaptador cameraScanner.ts, que se verifica a mano)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 3: Núcleo frontend

## 1. Contexto y alcance

Referencias: plan §2.1 (stack), §3 (convenciones), §4.3 (umbrales de capacidad), §6.1–6.2 (autenticación, permisos y sucursal), §7 (escaneo e impresión), §8 Fase 3, §9 (pruebas) y §12 (riesgos de cámara e impresión). Contratos de F1 §6 y endpoints de F2 §7.

**Objetivo:** dejar lista la base de la SPA que usarán todos los módulos. Al terminar F3:

- la SPA inicia sesión, la restaura al recargar, la renueva sola al expirar el access token y la cierra, también entre pestañas;
- el refresh nunca se dispara dos veces a la vez, ni en la misma pestaña ni entre pestañas, porque el backend revoca la familia ante cualquier reutilización (F2 §2);
- el servidor puede exigir el cambio de contraseña y la SPA lleva al usuario a hacerlo;
- el menú y las rutas se filtran por permisos, y el usuario con varias sucursales elige una;
- existe un design system *mobile-first* con tablas responsivas, diálogos, *toasts*, estados y barras de capacidad;
- `ScanInput` lee con la cámara, con un lector físico HID y por tecleo, y hay una página para probarlo;
- existen las primitivas de impresión (`PrintLayout`, `Barcode`, `QrCode`);
- la SPA se instala como PWA.

**Alcance (entra):**

1. Cliente HTTP `apiFetch` con token, sucursal, parseo del error estándar y refresh único.
2. `AuthProvider`, `/login`, cambio de contraseña obligatorio, logout y restauración de sesión.
3. Guards de ruta, `<Can>`, página "Sin acceso" y menú filtrado.
4. Contexto y selector de sucursal.
5. Design system y formato de dinero y fechas.
6. `ScanInput` y la página de prueba `/dev/scanner`.
7. `PrintLayout`, `Barcode` y `QrCode`.
8. PWA: manifest, íconos, service worker y aviso de nueva versión.
9. Proxy `/uploads` en Vite.

**Hardware (plan §13.6, respondida 2026-10-03):**

- **Tickets:** Epson TM-T20III, con papel de 80 mm y 72 mm de ancho imprimible. Se mantiene la opción de 58 mm.
- **Lector:** modelo no identificado. Funciona por cable USB y por Bluetooth con un receptor USB; en los dos casos actúa como teclado (HID).
- **Etiquetas:** Ribetec RT-420ME (térmica de 4", 203 dpi) para 50×25 mm y 4×6", más hojas A4 o Carta en una impresora normal.

Los tamaños de plan §7.2 quedan confirmados.

**Fuera de alcance:** ver la cabecera. **Regresión declarada de F0:** el menú filtrado por permisos y las rutas protegidas obligan a adaptar los tests T9 y T10 de F0 (`AppLayout.test.tsx`), que deben seguir en verde. Es el único cambio permitido sobre entregables de pruebas de F0.

---

## 2. Modelo de datos afectado

N/A en esta fase. La SPA no define datos propios. Consume estos contratos de `@warehouse-manager/shared`:

| Contrato | Origen | Uso en F3 |
|---|---|---|
| `LoginInput`, `ChangePasswordInput`, `MeDto`, `AuthSessionDto` | F2 §6.3 | Formularios y sesión |
| `ApiErrorDto`, `ErrorCode`, `ValidationIssue` | F1 §6.9, F2 §6.1 | Parseo de errores |
| `PermissionCode`, `SYSTEM_ROLES` | F1 §6.4 | `<Can>`, guards y fixtures de tests |
| `classifyScan` | F1 §6.8 | Clasificación de lecturas de `ScanInput` |
| `formatMoney` | F1 §6.5 | Componente `Money` |
| `HealthDto` | F0, F2 §6.2 | Sin cambios (`HealthStatus` de F0) |

---

## 3. Endpoints

N/A: F3 no crea endpoints. Consume estos de F2:

| Endpoint | Uso |
|---|---|
| `POST /api/v1/auth/login` | `LoginPage` |
| `POST /api/v1/auth/refresh` | Arranque y refresh ante un 401 |
| `POST /api/v1/auth/logout` | Menú de usuario y cambio de contraseña |
| `GET /api/v1/auth/me` | No se usa en F3: `AuthSessionDto` ya trae `me`. Queda disponible para módulos posteriores. |
| `POST /api/v1/auth/change-password` | `ChangePasswordPage` |
| `GET /uploads/*` | Solo el proxy de Vite (§4) |

---

## 4. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Access token | Solo en memoria (`sessionStore`), junto con el `MeDto`. Nunca se escribe en ningún almacenamiento del navegador. Al recargar, la sesión se restaura con `POST /auth/refresh` (la cookie `wm_rt` es `httpOnly`). |
| `apiFetch` | `apiFetch<T>(path, { method, body, schema?, signal? })`. Rutas relativas (`/api/v1/...`) y `credentials: 'same-origin'`. Agrega `Authorization: Bearer` si hay token y `X-Branch-Id` si hay sucursal elegida. Serializa el `body` a JSON. Con `schema`, valida la respuesta (`schema.parse`); un 204 devuelve `undefined`. |
| Errores | Respuesta no 2xx con un `ApiErrorDto` válido → `ApiError { status, code, message, details }`. Respuesta no 2xx sin un `ApiErrorDto` válido → `ApiError` con `INTERNAL_ERROR` y el mensaje "Ocurrió un error inesperado. Intenta de nuevo.". Fallo de red → `NetworkError` con "Sin conexión con el servidor.". La UI muestra `message`, que ya viene en español desde la API, y decide por `code` cuando hace falta. |
| Refresh ante 401 | Cualquier 401 dispara un refresh y **un solo** reintento de la petición original (F2 §9.1), salvo en `/auth/login`, `/auth/refresh` y `/auth/logout`, que nunca disparan refresh (así no hay bucles). |
| Refresh único (*single-flight*) | `refreshSession()` comparte una sola promesa en la pestaña. Dentro corre `navigator.locks.request('wm-refresh', …)`, así que entre pestañas los refresh son secuenciales. La pestaña que espera el lock envía su refresh **después** de que la otra terminó, con la cookie ya rotada que el navegador adjunta en ese momento, y por eso no hay reutilización. Si `navigator.locks` no existe, se usa solo la promesa compartida. |
| Fallo del refresh | 401 (`AUTH_REFRESH_INVALID` o `AUTH_REFRESH_REUSED`) → se limpia la sesión, se avisa con el *toast* "Tu sesión expiró. Inicia sesión de nuevo." y se navega a `/login?next=<ruta actual>`. Las peticiones en espera fallan con `ApiError` `UNAUTHENTICATED`. Un **error de red** durante el refresh **no** cierra la sesión: se propaga como `NetworkError`. |
| Cambio de contraseña exigido | Un 403 `AUTH_PASSWORD_CHANGE_REQUIRED` marca `mustChangePassword = true` en la sesión, y el guard lleva a `/change-password`. |
| Arranque | `AuthProvider` empieza en `loading`, con una pantalla de carga, y llama a `refreshSession()`. 200 → `authenticated`; 401 → `anonymous`; error de red → `ErrorState` "No se pudo conectar con el servidor" con "Reintentar". |
| `next` seguro | Solo se respeta un `next` que empiece con `/` y no con `//`. Cualquier otro valor se cambia por `/`, para evitar redirecciones abiertas. |
| Logout | `POST /auth/logout`, ignorando cualquier error (incluido el de red). Después: se limpia la sesión, se vacía la caché de TanStack Query (`queryClient.clear()`), se envía `{ type: 'logout' }` por `BroadcastChannel('wm-auth')` y se navega a `/login`. Las otras pestañas, al recibir el mensaje, limpian su sesión y navegan a `/login`. |
| Guards | `RequireAuth` (sin sesión → `/login?next=`), `RequirePasswordChanged` (con `mustChangePassword` → `/change-password`), `RequireBranch` (sin sucursal elegida → `/select-branch`) y `RequirePermission` (sin permiso → `NoAccessPage` en la misma URL, sin redirigir). |
| Permisos en la UI | `useAuth().can(perm)` lee `me.permissions`. `<Can perm="x.y">` o `<Can anyOf={[…]}>` con `fallback` opcional. Los permisos se actualizan en cada refresh, igual que en el backend (F2 §2). |
| Permiso por módulo (`modules.ts`) | Almacén → `warehouse.read`; Productos → `products.read`; POS → `pos.sell`; Reportes → `reports.sales`; Usuarios → `users.read`; Ajustes → cualquiera de `settings.branch` o `settings.registers`. El menú (barra inferior y lateral) solo muestra los módulos permitidos. Inicio (`/`) es visible para cualquier usuario autenticado. |
| Sucursal | Sin sucursales → pantalla "Tu usuario no tiene sucursales asignadas" con logout. Una sola sucursal → se elige automáticamente. Más de una → se usa la guardada si sigue en `me.branches`; si no, `/select-branch`, con la sucursal `isDefault` preseleccionada. La elección se guarda en `localStorage` con la clave `wm.branch.<userId>` (solo el id; los accesos a `localStorage` van en `try/catch`). Al cambiar de sucursal se vacía la caché de TanStack Query. |
| Formularios | React Hook Form + `zodResolver` con `LoginInput` y `ChangePasswordInput` de `shared`, sin redefinir esquemas. La confirmación de la contraseña nueva se valida en el formulario con una regla `validate` ("Las contraseñas no coinciden"), porque no forma parte del contrato. Un `VALIDATION_ERROR` del servidor se asigna a los campos por `details[].path`. |
| shadcn/ui | Se agregan solo `button`, `input`, `label`, `card`, `dialog`, `sheet`, `sonner` y `skeleton` en `src/shared/ui/`. El wrapper de `sonner` se adapta para **no** usar `next-themes`, porque la app no cambia de tema. Objetivos táctiles ≥ 44 px. |
| Componentes propios | `DataTable` (tabla desde `md`, tarjetas por debajo, con `useMediaQuery('(min-width: 768px)')`); `LoadingState`, `EmptyState` y `ErrorState` (con "Reintentar"); `ResponsiveDialog` (`Dialog` desde `md`, `Sheet` inferior por debajo) y `ConfirmDialog`; `notify.success/error` sobre `sonner`; `CapacityBar`. |
| `CapacityBar` | Props `used`, `capacity` y `unlimited?`. Verde < 70 %, ámbar de 70 % a 90 % (inclusive) y rojo > 90 % (plan §4.3). Texto "34 / 40 (85 %)". Por encima del 100 % (capacidad excedida con autorización) la barra se llena en rojo y el texto muestra el porcentaje real. `unlimited` (staging) → "Sin límite", sin color de estado. `capacity = 0` → "Sin capacidad". Accesible con `role="meter"` y `aria-valuenow`. |
| Formato | `Money` usa `formatMoney` de `shared`. `formatDateTime(iso, timeZone)` y `formatDate(iso, timeZone)` usan `Intl.DateTimeFormat('es-MX', …)` y viven en `apps/web/src/shared/format/`. `timeZone` es obligatorio en la firma, y el default de la app es `America/Mexico_City`, porque `MeDto` no trae la zona de la sucursal: los módulos le pasarán `BranchDto.timezone` desde F5. |
| `ScanInput` | Props `onScan(result)`, `captureHid?` y `continuous?`. Clasifica cada lectura con `classifyScan`. Una lectura `invalid` no llama a `onScan`: muestra "Código no reconocido". Una lectura `promo` (QR de promoción del ticket, F1 §6.8) sí llega a `onScan`: cada módulo decide qué hacer, y los que no la esperan (almacén, productos) muestran "Este código es de una promoción, no de un producto". Tras cada lectura, el campo se limpia y recupera el foco. |
| Modo cámara | `@zxing/browser` (`BrowserMultiFormatReader`) con Code128, EAN-13 y QR, detrás del adaptador `cameraScanner.ts` (`start`, `stop`, `onCode`, `torchSupported`, `setTorch`). Visor de pantalla completa en móvil, con la cámara trasera. Linterna solo si la pista de video declara `torch`. Al leer: vibración (`navigator.vibrate(100)`) y un beep corto con Web Audio, sin archivos de audio. Anti-rebote: el mismo código dentro de 1,5 s se ignora. Sin `isSecureContext` o sin `mediaDevices` → botón deshabilitado con "La cámara requiere HTTPS". Permiso denegado → "No se pudo acceder a la cámara" y queda el modo manual. Con `continuous: false` el visor se cierra tras la primera lectura. |
| Modo HID | `hidDetector` puro: una ráfaga de ≥ 4 caracteres con intervalos ≤ 35 ms, terminada en `Enter`, es un escaneo. Con `captureHid`, escucha `keydown` en `document` y captura la ráfaga cuando el foco está fuera de campos editables. Si el foco está en otro campo editable, no se captura (la recibe ese campo). Si el foco está en el propio `ScanInput`, lo maneja el input, sin duplicar. |
| Página de prueba | `/dev/scanner` ("Prueba de escáner e impresión"), para cualquier usuario autenticado, enlazada desde el menú de usuario. Muestra cada lectura (`kind` y `code`), el `Barcode` o `QrCode` del último código y "Imprimir etiqueta de prueba" (50×25 mm). Sirve para verificar en campo la cámara, el lector y la impresora. |
| Impresión | `PrintLayout({ size })` monta su contenido en un portal `#print-root` e inyecta `@page { size; margin: 0 }`. Con `@media print`, todo lo que no sea `#print-root` se oculta. Tamaños: `label-50x25` (`50mm 25mm`), `label-4x6` (`4in 6in`), `a4` (`A4`), `letter` (`letter`), `ticket-80` (`80mm auto`) y `ticket-58` (`58mm auto`). El contenido de `ticket-80` mide 72 mm de ancho y el de `ticket-58`, 48 mm: es el ancho imprimible de las térmicas. `usePrint()` llama a `window.print()` después del render. La TM-T20III y la RT-420ME se instalan como impresoras del sistema (plan §7.2). |
| `Barcode` / `QrCode` | `Barcode`: `JsBarcode` sobre un `<svg>` con Code128 y el texto visible; un valor vacío o inválido muestra "Código inválido". `QrCode`: arma el `<svg>` con `<rect>` a partir de `QRCode.create(value, { errorCorrectionLevel: 'M' }).modules`, sin `innerHTML`. |
| PWA | `vite-plugin-pwa` con `registerType: 'prompt'`, para no recargar la app a mitad de una venta. Ante una versión nueva, un *toast* "Hay una nueva versión disponible" con el botón "Actualizar". Precache de *assets* (`js`, `css`, `html`, `svg`, `png`, `woff2`). `navigateFallback: '/index.html'` con `navigateFallbackDenylist` para `/api/` y `/uploads/`. Sin `runtimeCaching`. La configuración vive en `src/app/pwaManifest.ts` (testeable) y la importa `vite.config.ts`. El registro (`virtual:pwa-register`) solo ocurre en `main.tsx` (regla de `import.meta` de F0). |
| Manifest | `name: 'warehouse-manager'`, `short_name: 'Almacén'`, `lang: 'es-MX'`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`, `orientation: 'portrait'`, `theme_color` y `background_color` del token de shadcn. Íconos 192, 512 y 512 *maskable*, más `apple-touch-icon` de 180. |
| Íconos | Fuente `public/icons/icon.svg`. Los PNG se generan una vez con `pnpm dlx @vite-pwa/assets-generator`, que **no** es dependencia, y se versionan. |
| Proxy `/uploads` | `vite.config.ts` agrega `/uploads` → `API_PROXY_TARGET`, igual que `/api` (pendiente de F2 §1). |

---

## 5. Dependencias autorizadas (lista cerrada)

| Paquete | Dependencias | DevDependencies |
|---|---|---|
| `apps/web` | `react-hook-form`, `@hookform/resolvers`, `@zxing/browser`, `@zxing/library`, `jsbarcode`, `qrcode`, `sonner` y los paquetes Radix que el CLI de shadcn agregue para los 8 componentes de §4 | `vite-plugin-pwa`, `workbox-window` (peer dependency de `vite-plugin-pwa`, autorizada el 2026-10-10), `@types/qrcode`, `@testing-library/user-event` |

Cualquier otra dependencia se pregunta (P2), incluido `next-themes`, que no se usa.

---

## 6. Estructura de archivos

```
apps/web/
├── vite.config.ts                     # (extendido: proxy /uploads, VitePWA)
├── components.json                    # (F0; alias de ui → src/shared/ui)
├── public/icons/                      # icon.svg + PNG 192, 512, maskable-512, apple-touch-icon-180
└── src/
    ├── main.tsx                       # (extendido: registro del service worker)
    ├── app/
    │   ├── providers.tsx              # (extendido: AuthProvider, BranchProvider, Toaster)
    │   ├── routes.tsx                 # (extendido: rutas públicas y protegidas con guards)
    │   ├── AppLayout.tsx              # (extendido: menú filtrado, menú de usuario, sucursal actual)
    │   ├── modules.ts                 # (extendido: permission por módulo)
    │   ├── pwaManifest.ts             # manifest + opciones de workbox
    │   └── pwaUpdate.ts               # showUpdateToast(update)
    ├── shared/
    │   ├── api/
    │   │   ├── apiClient.ts           # apiFetch, configureApiClient
    │   │   ├── errors.ts              # ApiError, NetworkError
    │   │   └── refresh.ts             # refreshSession (single-flight + Web Locks)
    │   ├── ui/                        # componentes shadcn + DataTable, states, CapacityBar,
    │   │                              # ResponsiveDialog, ConfirmDialog, notify
    │   ├── hooks/useMediaQuery.ts
    │   ├── format/                    # date.ts, Money.tsx
    │   ├── scan/
    │   │   ├── ScanInput.tsx
    │   │   ├── hidDetector.ts
    │   │   ├── cameraScanner.ts       # adaptador de @zxing/browser (excluido de cobertura)
    │   │   ├── CameraViewer.tsx
    │   │   └── feedback.ts            # vibración + beep
    │   ├── print/                     # PrintLayout.tsx (+ usePrint), Barcode.tsx, QrCode.tsx
    │   └── ComingSoonPage.tsx         # (F0)
    └── features/
        ├── auth/
        │   ├── sessionStore.ts
        │   ├── AuthProvider.tsx       # useAuth, arranque, logout, BroadcastChannel
        │   ├── guards.tsx             # RequireAuth, RequirePasswordChanged, RequireBranch,
        │   │                          # RequirePermission, Can
        │   ├── safeNext.ts
        │   ├── LoginPage.tsx
        │   ├── ChangePasswordPage.tsx
        │   └── NoAccessPage.tsx
        ├── branch/
        │   ├── BranchProvider.tsx     # useBranch, persistencia, X-Branch-Id
        │   └── SelectBranchPage.tsx
        ├── dev/ScannerTestPage.tsx
        ├── health/                    # (F0, sin cambios)
        └── home/HomePage.tsx          # (F0)
```

Los tests van junto a cada archivo (`*.test.ts(x)`). `matchMedia`, `BroadcastChannel`, `navigator.locks`, `mediaDevices`, `vibrate` y `window.print` se simulan en los tests que los necesitan.

---

## 7. Pantallas (wireframe en texto)

Los textos visibles van en español.

**Arranque** (`AuthProvider` en `loading`): logo + "Cargando…". Si hay error de red: "No se pudo conectar con el servidor" + [Reintentar].

**Login (`/login`)**

```
┌──────────────────────────────┐
│        warehouse-manager     │
│                              │
│  Usuario                     │
│  [________________________]  │
│  Contraseña                  │
│  [____________________] 👁   │
│                              │
│  ⚠ Usuario o contraseña      │  ← mensaje de la API (401/429)
│    incorrectos               │
│                              │
│  [      Iniciar sesión     ] │  ← deshabilitado mientras envía
└──────────────────────────────┘
```

**Cambio de contraseña obligatorio (`/change-password`)**

```
┌──────────────────────────────┐
│  Cambia tu contraseña        │
│  Por seguridad, debes cambiar│
│  tu contraseña para continuar│
│                              │
│  Contraseña actual  [______] │  ← AUTH_PASSWORD_INCORRECT aquí
│  Nueva contraseña   [______] │  ← mín. 8 caracteres
│  Confirmar nueva    [______] │
│                              │
│  [     Guardar contraseña   ]│
│        Cerrar sesión         │  ← enlace
└──────────────────────────────┘
```

**Selector de sucursal (`/select-branch`)**

```
  Elige la sucursal
  ┌────────────────────────────┐
  │ ◉ S1 · Sucursal Centro  (predeterminada)
  │ ○ S2 · Sucursal Norte      │
  └────────────────────────────┘
  [         Continuar          ]
```

**Layout (cambios sobre F0)**: el header muestra a la derecha la sucursal actual (si hay más de una) y el botón de usuario (iniciales). La barra inferior y la lateral solo muestran los módulos permitidos.

```
┌──────────────────────────────┐
│ warehouse-manager  S1 · (EC) │  ← (EC) abre el menú de usuario
├──────────────────────────────┤
│  …                           │
├──────────────────────────────┤
│  ▦     ▣     ⌁     ▤         │  ← p. ej. Vendedor: 4 módulos
│Almac. Prod.  POS  Rep.       │
└──────────────────────────────┘
```

**Menú de usuario** (hoja inferior en móvil, diálogo en escritorio): nombre completo y rol · "Sucursal: S1 · Centro" + [Cambiar sucursal] (si hay más de una) · [Probar escáner] · [Cerrar sesión].

**Sin acceso** (misma URL): "No tienes permiso para ver esta sección." + [Ir a Inicio].

**Sin sucursales:** "Tu usuario no tiene sucursales asignadas. Pide a un administrador que te asigne una." + [Cerrar sesión].

**`ScanInput`**

```
  [ Escanea o escribe un código   ] [📷]
  ⚠ Código no reconocido            ← solo con lecturas invalid
```

**Visor de cámara** (pantalla completa en móvil)

```
┌──────────────────────────────┐
│ ✕                       🔦   │  ← linterna solo si se soporta
│                              │
│      ┌──────────────┐        │
│      │   (video)    │        │
│      └──────────────┘        │
│  Apunta al código de barras  │
│  o al QR                     │
└──────────────────────────────┘
```

**Prueba de escáner (`/dev/scanner`)**: `ScanInput` con `captureHid` y `continuous` · lista de las últimas 10 lecturas (hora, origen cámara/lector/manual, `kind`, `code`) · vista del `Barcode` (producto) o `QrCode` (ubicación) del último código · [Imprimir etiqueta de prueba].

---

## 8. Reglas y casos borde

1. **Varias peticiones con el token vencido:** todas esperan un único refresh y se reintentan una vez con el token nuevo.
2. **Dos pestañas refrescan a la vez:** Web Locks las serializa y ninguna reutiliza el token (no hay `AUTH_REFRESH_REUSED`). En navegadores sin Web Locks (iOS < 15.4) el riesgo se acepta: el usuario vuelve a iniciar sesión.
3. **401 del propio refresh:** nunca dispara otro refresh. Se cierra la sesión local y se va a `/login`.
4. **Sin red durante el refresh:** no se cierra la sesión. La petición falla con `NetworkError` y la UI muestra "Sin conexión con el servidor.".
5. **Logout sin red:** la sesión local se cierra igual. La cookie se limpiará o expirará en el servidor.
6. **`next` malicioso** (`//evil.com` o `https://…`): se ignora y se navega a `/`.
7. **Sucursal guardada que ya no está en `me.branches`** (desasignada o inactiva): se descarta y se aplica la regla de §4.
8. **Permiso retirado:** se refleja en el menú tras el siguiente refresh (≤ 15 min, F2 §14). Si la API responde 403 `FORBIDDEN` antes, la UI muestra su `message`.
9. **Cámara denegada, sin HTTPS o sin cámara:** se informa y queda disponible el tecleo manual. Nunca se rompe la pantalla.
10. **Lectura doble de la cámara:** el mismo código dentro de 1,5 s se ignora.
11. **Lector HID con el foco en otro campo editable:** la ráfaga la recibe ese campo y no se dispara `onScan`.
12. **Basura del lector** (`\r`, `\n`, `\t`): la limpia `classifyScan` (F1 §9.6).
13. **Nueva versión de la app:** no se recarga sola. El usuario decide con "Actualizar".
14. **Service worker y API:** `/api/*` y `/uploads/*` nunca se sirven desde la caché ni caen en el `navigateFallback`.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Dependencias.**
  - Instalar las de §5 y agregar con el CLI de shadcn los 8 componentes de §4 (adaptar `sonner` sin `next-themes`).
  - *Verificable:* `pnpm --filter @warehouse-manager/web build` OK.
- [ ] **2. Cliente HTTP.**
  - Crear `shared/api/errors.ts`, `apiClient.ts` y `refresh.ts`. Tests **T1–T7**.
  - *Verificable:* T1–T7 en verde.
- [ ] **3. Sesión.**
  - Crear `sessionStore`, `AuthProvider` (arranque, logout, `BroadcastChannel`), `safeNext`, `LoginPage`, `RequireAuth` y las rutas públicas y protegidas. Tests **T8–T10**, **T13** y **T14**.
  - *Verificable:* T8–T10, T13 y T14 en verde.
- [ ] **4. Cambio de contraseña obligatorio.**
  - Crear `ChangePasswordPage` y `RequirePasswordChanged`, y conectar el 403 `AUTH_PASSWORD_CHANGE_REQUIRED`. Tests **T11–T12**.
  - *Verificable:* T11–T12 en verde.
- [ ] **5. Permisos y menú.**
  - Crear `<Can>`, `RequirePermission` y `NoAccessPage`; agregar `permission` en `modules.ts`; filtrar el menú; crear el menú de usuario. Adaptar T9/T10 de F0. Tests **T15–T18**.
  - *Verificable:* T15–T18 y los tests de F0 en verde.
- [ ] **6. Sucursal.**
  - Crear `BranchProvider`, `SelectBranchPage`, `RequireBranch`, la pantalla "Sin sucursales" y el header `X-Branch-Id`. Tests **T19–T20**.
  - *Verificable:* T19–T20 en verde.
- [ ] **7. Design system.**
  - Crear `DataTable`, los estados, `CapacityBar`, `ResponsiveDialog`, `ConfirmDialog`, `notify` y `useMediaQuery`. Tests **T21**, **T22** y **T24**.
  - *Verificable:* T21, T22 y T24 en verde.
- [ ] **8. Formato.**
  - Crear `shared/format/date.ts` y `Money.tsx`. Test **T23**.
  - *Verificable:* T23 en verde.
- [ ] **9. `ScanInput`.**
  - Crear `hidDetector`, `cameraScanner` (adaptador), `CameraViewer`, `feedback`, `ScanInput` y `ScannerTestPage`. Tests **T25–T28**.
  - *Verificable:* T25–T28 en verde, y en `https://<IP-LAN>:5173/dev/scanner` la cámara de un celular lee un Code128 y un QR.
- [ ] **10. Impresión.**
  - Crear `PrintLayout`, `usePrint`, `Barcode` y `QrCode`, y la etiqueta de prueba en `/dev/scanner`. Tests **T29–T30**.
  - *Verificable:* T29–T30 en verde, y la vista previa de impresión del navegador muestra la etiqueta de 50×25 mm.
- [ ] **11. PWA.**
  - Crear `pwaManifest.ts`, `pwaUpdate.ts` y los íconos; configurar `VitePWA` y registrar el service worker en `main.tsx`. Tests **T31–T32**.
  - *Verificable:* T31–T32 en verde, y `pnpm --filter @warehouse-manager/web build` genera `manifest.webmanifest` y `sw.js`.
- [ ] **12. Proxy `/uploads`.**
  - Agregar el proxy en `vite.config.ts`.
  - *Verificable:* con la API de desarrollo arriba, una imagen subida en F2 se abre en `https://localhost:5173/uploads/…`.
- [ ] **13. README y cierre.**
  - En el README: flujo de login y primer cambio de contraseña, instalar la PWA en Android (Chrome) e iOS (Safari, "Agregar a inicio"), uso de `/dev/scanner` y conexión del lector por cable o por Bluetooth (receptor USB).
  - En el README, configuración de impresión: tamaño de papel en el driver de la TM-T20III y de la RT-420ME, y en el diálogo del navegador márgenes "Ninguno" y escala 100 %.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales; registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 32)

Todos con Jest + React Testing Library (+ `user-event`) en `apps/web`. `fetch` se simula. Para el tiempo se usan *fake timers* solo donde se indica.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared/api/apiClient.test.ts` | Sin token no envía `Authorization`; con token envía `Bearer`; con sucursal envía `X-Branch-Id`; usa `credentials: 'same-origin'`; serializa el body JSON; valida la respuesta con `schema`; un 204 devuelve `undefined`. |
| T2 | `shared/api/apiClient.test.ts` | `it.each`: 409 con `ApiErrorDto` → `ApiError` con `status`, `code`, `message` y `details`; 500 con HTML → `ApiError` `INTERNAL_ERROR` con el mensaje genérico; `fetch` rechazado → `NetworkError` "Sin conexión con el servidor.". |
| T3 | `shared/api/apiClient.test.ts` | Un 401 provoca un `POST /auth/refresh`, guarda el token nuevo y reintenta una vez la petición con él; si el reintento vuelve a dar 401, falla sin un segundo refresh. |
| T4 | `shared/api/refresh.test.ts` | 5 peticiones en paralelo que reciben 401 → exactamente **1** `POST /auth/refresh`, y las 5 se reintentan y resuelven. |
| T5 | `shared/api/refresh.test.ts` | Con `navigator.locks` simulado, el refresh corre dentro de `locks.request('wm-refresh', …)`; sin `navigator.locks`, el refresh funciona igual. |
| T6 | `shared/api/refresh.test.ts` | Refresh con 401 `AUTH_REFRESH_REUSED` → `onSessionExpired` se llama una vez y las peticiones en espera fallan con `UNAUTHENTICATED`. Un 401 de `/auth/login`, `/auth/refresh` o `/auth/logout` nunca dispara refresh. Un error de red en el refresh **no** llama a `onSessionExpired`. |
| T7 | `shared/api/apiClient.test.ts` | Un 403 `AUTH_PASSWORD_CHANGE_REQUIRED` llama a `onPasswordChangeRequired` y la petición falla con ese `ApiError`. |
| T8 | `features/auth/AuthProvider.test.tsx` | Arranque: se muestra "Cargando…"; refresh 200 → sesión con el `me` recibido; refresh 401 → anónimo, y `/pos` redirige a `/login?next=%2Fpos`; error de red → "No se pudo conectar con el servidor" y "Reintentar" vuelve a llamar al refresh. |
| T9 | `features/auth/LoginPage.test.tsx` | Campos vacíos → mensajes de validación sin llamar a la API; `" Admin "` se envía como `"admin"`; 401 y 429 muestran el `message` de la API; el botón se deshabilita mientras envía. |
| T10 | `features/auth/LoginPage.test.tsx` + `safeNext.test.ts` | `it.each` del destino tras el login: `mustChangePassword` → `/change-password`; más de una sucursal sin elección guardada → `/select-branch`; una sucursal → `next` o `/`. `safeNext`: `/pos` se respeta; `//evil.com`, `https://evil.com` y `pos` → `/`. |
| T11 | `features/auth/ChangePasswordPage.test.tsx` | Confirmación distinta → "Las contraseñas no coinciden" sin llamar a la API; nueva igual a la actual → mensaje del esquema; `AUTH_PASSWORD_INCORRECT` → error en "Contraseña actual"; éxito → sesión con `mustChangePassword: false`, *toast* y navegación al siguiente destino. |
| T12 | `features/auth/guards.test.tsx` | Con `mustChangePassword`: `/pos` redirige a `/change-password`; `/change-password` se muestra y su "Cerrar sesión" funciona. |
| T13 | `features/auth/AuthProvider.test.tsx` | Logout: llama a `POST /auth/logout`, limpia la sesión, vacía la caché de TanStack Query, publica `{ type: 'logout' }` en `BroadcastChannel('wm-auth')` y navega a `/login`. Con error de red en el logout, la sesión local se cierra igual. |
| T14 | `features/auth/AuthProvider.test.tsx` | Al recibir `{ type: 'logout' }` por el canal simulado, la pestaña limpia su sesión y navega a `/login`. |
| T15 | `features/auth/guards.test.tsx` | `<Can perm>` muestra el contenido con el permiso y el `fallback` sin él; `<Can anyOf>` basta con uno. |
| T16 | `features/auth/guards.test.tsx` | Sin `warehouse.read`, `/warehouse` muestra "No tienes permiso para ver esta sección." en la misma URL; con el permiso, el placeholder del módulo. |
| T17 | `app/AppLayout.test.tsx` | (Adapta T9 de F0.) `it.each` por rol con los permisos de `SYSTEM_ROLES`: `OWNER`, `ADMIN` y `MANAGER` → 6 enlaces; `SELLER` → Almacén, Productos, POS y Reportes; `WAREHOUSE_CLERK` → Almacén y Productos. Cada enlace tiene su `href` correcto. |
| T18 | `app/AppLayout.test.tsx` | (Adapta T10 de F0.) Con sesión que tiene `pos.sell` y router en `/pos` → placeholder "POS" y "Próximamente", sin más llamadas a `fetch` que el refresh de arranque. |
| T19 | `features/branch/BranchProvider.test.tsx` | `it.each`: elección guardada válida → se usa; guardada que ya no está en `branches` → `/select-branch` con la predeterminada preseleccionada; una sola sucursal → automática y sin selector; ninguna → "Tu usuario no tiene sucursales asignadas". Elegir guarda `wm.branch.<userId>`. |
| T20 | `features/branch/BranchProvider.test.tsx` | Cambiar de sucursal cambia el `X-Branch-Id` de la siguiente petición y vacía la caché de TanStack Query. |
| T21 | `shared/ui/DataTable.test.tsx` | Con `matchMedia` ≥ 768 px → `<table>` con encabezados; < 768 px → lista de tarjetas. `loading`, vacío y error muestran su estado ("Reintentar" llama a `onRetry`). `onRowClick` recibe la fila. |
| T22 | `shared/ui/CapacityBar.test.tsx` | `it.each`: 0/40 verde; 27/40 verde; 28/40 (70 %) ámbar; 36/40 (90 %) ámbar; 37/40 rojo; 45/40 rojo con "113 %"; `unlimited` → "Sin límite"; capacidad 0 → "Sin capacidad". `role="meter"` con `aria-valuenow`. |
| T23 | `shared/format/date.test.ts` | `formatDateTime('2026-10-02T05:30:00Z', 'America/Mexico_City')` muestra el 1 de octubre a las 23:30 (borde de día); `formatDate` respeta la zona; `Money` muestra `formatMoney(123450)`. |
| T24 | `shared/ui/ResponsiveDialog.test.tsx` | En < 768 px se usa la hoja inferior y en ≥ 768 px el diálogo. `ConfirmDialog`: "Confirmar" llama a `onConfirm` y "Cancelar" cierra sin llamarlo. `notify.error(apiError)` muestra el `message` en un *toast*. |
| T25 | `shared/scan/hidDetector.test.ts` | Con tiempos simulados: `ZAP0101-25-NEG` + `Enter` a 10 ms por tecla → emite; la misma cadena a 100 ms → no emite; 3 caracteres + `Enter` → no emite; con el foco en otro `<input>` → no emite. |
| T26 | `shared/scan/ScanInput.test.tsx` | Tecleo manual + `Enter`: `"loc:a-1-3"` → `onScan({ kind: 'location', code: 'A-01-03' })`; `"ZAP 01"` → "Código no reconocido" sin `onScan`; `"PROMO:DESC10"` → `onScan({ kind: 'promo', text: 'DESC10' })`. Tras leer, el campo queda vacío y con foco. Una ráfaga HID con el foco en el propio `ScanInput` emite una sola vez. |
| T27 | `shared/scan/ScanInput.test.tsx` | Con el adaptador de cámara simulado: abre el visor; un código leído llama a `onScan`, vibra y cierra el visor (`continuous: false`); el mismo código dos veces en < 1,5 s → un solo `onScan` (*fake timers*); permiso denegado → "No se pudo acceder a la cámara"; sin `isSecureContext` → botón deshabilitado con "La cámara requiere HTTPS". |
| T28 | `shared/scan/ScanInput.test.tsx` | Con `torchSupported: true` aparece "Linterna" y alterna `setTorch(true/false)`; con `false` no aparece. |
| T29 | `shared/print/Barcode.test.tsx` + `QrCode.test.tsx` | `Barcode` de `ZAP0101-25-NEG` renderiza un `<svg>` con el texto visible; valor vacío → "Código inválido". `QrCode` de `LOC:A-01-03` renderiza un `<svg>` con `<rect>` y el mismo valor produce el mismo SVG. |
| T30 | `shared/print/PrintLayout.test.tsx` | `it.each` de los 6 tamaños: el `@page` inyectado tiene el `size` de §4 y el contenido va en `#print-root`; en `ticket-80` el contenido mide 72 mm de ancho y en `ticket-58`, 48 mm. `usePrint()` llama a `window.print` (simulado). |
| T31 | `app/pwaManifest.test.ts` | El manifest tiene `name`, `short_name`, `lang: 'es-MX'`, `display: 'standalone'`, `start_url: '/'` e íconos 192, 512 y *maskable*. `navigateFallbackDenylist` coincide con `/api/v1/health` y `/uploads/product/x.webp`, pero no con `/pos`. No hay `runtimeCaching`. |
| T32 | `app/pwaUpdate.test.tsx` | `showUpdateToast(update)` muestra "Hay una nueva versión disponible"; "Actualizar" llama a `update` una vez. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests T9 y T10 de F0 se adaptan en T17 y T18 (regresión declarada en §1). El resto de los tests de F0, F1 y F2 siguen en verde.

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Login y logout funcionan en móvil y escritorio. | T9, T13 + verificación manual (dispositivo y navegador en §12) |
| CA2 | La sesión sobrevive a una recarga, se renueva sola al expirar el access token y, si el refresh falla, lleva al login. | T3, T6, T8 + verificación manual con `ACCESS_TTL_MIN=1` |
| CA3 | Dos pestañas abiertas que refrescan a la vez no provocan `AUTH_REFRESH_REUSED`, y un logout en una cierra la otra. | T4, T5, T14 + verificación manual |
| CA4 | Con `mustChangePassword`, la SPA solo permite cambiar la contraseña o cerrar sesión, y después continúa normalmente. | T11, T12 |
| CA5 | El menú y las rutas respetan los permisos de cada rol del sistema. | T15–T18 |
| CA6 | Un usuario con varias sucursales elige una, la elección persiste y viaja en `X-Branch-Id`. | T19, T20 |
| CA7 | La cámara de un celular Android y de un iPhone, por HTTPS, lee Code128 y QR en `/dev/scanner`. | Verificación manual (dispositivo, SO y navegador en §12) |
| CA8 | El lector funciona en el mismo campo, por cable USB y por Bluetooth (receptor USB), también con el foco fuera de campos editables. | T25, T26 + verificación manual |
| CA9 | La etiqueta de prueba de 50×25 mm impresa en la Ribetec RT-420ME se lee con la cámara y con el lector. | Verificación manual |
| CA10 | La PWA se instala en Android e iOS, abre en modo *standalone* y nunca sirve `/api` desde la caché. | T31 + verificación manual |
| CA11 | `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan en limpio, incluidos los tests de F0, F1 y F2. | Salida de los comandos en §12 |
| CA12 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |
| CA13 | El plan §13.6 registra el hardware y `PrintLayout` incluye los tamaños confirmados (A4, Carta, 50×25 mm, 4×6" y tickets de 80 y 58 mm). | Plan §13 + T30 |

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

### Verificación manual (parcial, 2026-10-10)

| CA | Dispositivo y navegador | Resultado |
|---|---|---|
| CA1 | Android (Chrome) y escritorio (Chrome), servidor de desarrollo por HTTPS en la LAN | OK: login, logout y cambio de contraseña obligatorio de `admin` y `owner` |
| CA2 | Escritorio (Chrome), API con `ACCESS_TTL_MIN=1` | OK: la sesión se renueva sola al expirar el access token |
| CA3 | Escritorio (Chrome), dos pestañas | OK: el logout en una pestaña cierra la otra |
| CA7 | Android (Chrome), cámara por HTTPS | OK: lee QR y Code128. **iPhone pendiente** |
| CA8 | PC de la sucursal (Chrome) vía túnel de Cloudflare | OK: lector por cable USB y por Bluetooth |
| CA10 | Android (Chrome): build (`vite preview`, :4173) y desarrollo (:5173) | OK: se instala y abre como app. **iOS pendiente** |
| — | Proxy de `/uploads` en desarrollo | OK: imagen existente 200 `image/png`; inexistente 404 |

**Pendiente para cerrar:**
- CA9: imprimir la etiqueta de prueba 50×25 mm en la Ribetec RT-420ME y leerla con cámara y lector.
- CA7 y CA10 en iPhone.
- CA8: confirmar la lectura con el foco fuera de campos editables.
- Aprobar las 8 propuestas del 2026-10-10 en §13.
- Salidas de lint, typecheck, test, build y cobertura (CA11 y CA12) al cerrar.

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-02 | El refresh se serializa entre pestañas con Web Locks, porque el backend revoca la familia ante cualquier reutilización. | Usuario (chat); plan §6.1 y §8 F3 |
| 2026-10-02 | §13.6 (hardware) queda pendiente: F3 usa los tamaños del plan §7.2 y la pregunta se resuelve antes de cerrar la fase. | Usuario (chat) |
| 2026-10-02 | `depende_de: [fase-02]`: secuencia por defecto (constitución P1) y los CA de sesión requieren la API real. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | Cualquier 401 refresca y reintenta una vez, salvo login, refresh y logout. Un error de red en el refresh no cierra la sesión. `next` solo admite rutas internas. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | El logout se propaga a las demás pestañas con `BroadcastChannel('wm-auth')`. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | Con más de una sucursal se pregunta siempre (con la predeterminada preseleccionada) y la elección se guarda en `localStorage` por usuario. Al cambiar, se vacía la caché. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | Permiso por módulo del menú: `warehouse.read`, `products.read`, `pos.sell`, `reports.sales`, `users.read` y `settings.*` (cualquiera). La página "Sin acceso" no redirige. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | Las fechas se formatean en `apps/web` con la zona horaria como parámetro (default `America/Mexico_City`), porque `MeDto` no trae la zona de la sucursal. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | HID: ráfaga ≥ 4 caracteres a ≤ 35 ms con `Enter`; no se captura si el foco está en otro campo editable. Anti-rebote de cámara de 1,5 s. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | La cámara va detrás del adaptador `cameraScanner.ts`, excluido de cobertura y verificado a mano (CA7). | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | `/dev/scanner` disponible para cualquier usuario autenticado en todos los entornos, con etiqueta de prueba imprimible. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | `QrCode` se arma con `<rect>` desde la matriz de `qrcode`, sin `innerHTML`. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | PWA con `registerType: 'prompt'` (no recarga a mitad de una venta), sin `runtimeCaching`, e íconos PNG generados una vez con `pnpm dlx @vite-pwa/assets-generator` y versionados. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | El wrapper de `sonner` de shadcn no usa `next-themes`. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-02 | Se adaptan los tests T9 y T10 de F0 por el menú filtrado y las rutas protegidas (regresión declarada). | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-03 | El usuario aprueba la spec completa, incluidas las propuestas del agente. Spec pasa a `LISTA`. §13.6 sigue pendiente y bloquea solo el cierre (CA13). | Usuario (chat) |
| 2026-10-03 | §13.6 respondida: Epson TM-T20III, lector HID por cable o Bluetooth, Ribetec RT-420ME y hojas A4 o Carta. Se agrega el tamaño Carta. | Usuario (chat); plan §13.6 y §7.2 actualizados |
| 2026-10-03 | El contenido del ticket mide 72 mm (papel de 80 mm) y 48 mm (papel de 58 mm), el ancho imprimible. | Propuesta del agente; aprobada por el usuario (2026-10-03) |
| 2026-10-03 | Rol `OWNER` ("Propietario"): T17 lo incluye con los 6 módulos. | Usuario (chat), durante la redacción de F4; F1 §6.4 actualizado |
| 2026-10-03 | `ScanInput` entrega las lecturas `promo` (QR de promoción) a `onScan`; `/dev/scanner` las muestra con su texto. T26 agrega el caso. | Usuario (chat), durante la redacción de F5; F1 §6.8 actualizado |
| 2026-10-10 | Entorno de Jest propio (`src/test/jsdom-environment.cjs`): jsdom con `Request`, `Response`, `Headers`, `AbortController` y `structuredClone` de Node, porque React Router 8 crea un `Request` en cada navegación. `FormData` y `Blob` quedan los de jsdom. | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | El CLI de shadcn agregó `next-themes` y un paquete npm ajeno llamado `cn`: se quitaron y los imports apuntan a `@/lib/utils`. Botones e inputs de 44 px de alto (`h-11`). | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | Tras un logout se va a `/login` sin `next`; si la sesión expira, se conserva `next` con la ruta actual (`sessionStore` guarda el motivo). | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | La confirmación de la contraseña nueva se valida con un *resolver* que envuelve `zodResolver(ChangePasswordInput)`, en lugar de una regla `validate`: mismo mensaje y sin llamar a la API. Los mensajes de Zod de los formularios se traducen con `spanishErrors`. | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | `onScan(result, { source })`: el segundo argumento (`camera`, `hid` o `manual`) alimenta la columna "Origen" de `/dev/scanner`. Tras una lectura de cámara el foco no vuelve al campo, porque en el celular abriría el teclado; tras tecleo o lector sí. Una lectura inválida de la cámara deja el visor abierto con "Código no reconocido". `cameraAvailable()` vive en `CameraViewer.tsx` para quedar cubierta por tests. | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | `@page { size: 80mm auto }` y `58mm auto` (§4, T30) no son CSS válido: el navegador los ignora y usa el papel del driver. Se mantienen como dice la spec; `PrintLayout` fija el ancho del contenido (72 y 48 mm) y el README indica elegir el rollo en el driver. | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | `theme_color` y `background_color` = `#ffffff` (`--background` de shadcn, igual que el header). Íconos: `public/icons/icon.svg` (caja) y PNG generados con `pnpm dlx @vite-pwa/assets-generator` y una configuración de un solo uso fuera del repo (fondo `#171717` en *maskable* y Apple). | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | T23 vive en `date.test.ts`, como dice §10: renderiza `Money` con `createElement`. Se agrega `formatTime` (hora de `/dev/scanner`). | Propuesta del agente; pendiente de aprobación |
| 2026-10-10 | Q1: se agrega `workbox-window` como devDependency de `apps/web`. Es peer dependency obligatoria de `vite-plugin-pwa`, y sin ella `virtual:pwa-register` no se resuelve con pnpm y `pnpm build` falla. | Usuario (chat), durante la implementación (TODO 11) |
