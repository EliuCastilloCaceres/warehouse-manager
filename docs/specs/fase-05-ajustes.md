---
id: fase-05
titulo: "Ajustes: sucursal y cajas"
estado: LISTA
depende_de: [fase-04]
autoriza_codigo_en:
  - "apps/api/src/modules/settings/**"
  - "apps/api/src/app.ts"
  - "apps/api/test/integration/settings-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/settings.ts"
  - "packages/shared/src/settings.test.ts"
  - "apps/web/src/features/settings/**"
  - "apps/web/src/shared/ticket/**"
  - "apps/web/src/shared/api/apiClient.ts"
  - "apps/web/src/shared/api/apiClient.test.ts"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Alta, baja, activación o desactivación de sucursales y cajas (multi-sucursal completa es post-MVP)"
  - "Editar Branch.code (es el prefijo de los folios) o Branch.currency (MXN fija, plan §13.1)"
  - "Plantilla final del ticket de venta con partidas reales, pagos, folio y reimpresión (F8)"
  - "Reglas definitivas de cálculo y redondeo de impuestos de venta (F8); la vista previa usa un cálculo provisional"
  - "Lectura de los datos del ticket por usuarios sin settings.branch, como el vendedor que imprime en el POS (la define F8)"
  - "Cupones de descuento validados por el sistema (post-MVP, plan §11)"
  - "Limpieza de imágenes reemplazadas o huérfanas"
  - "Bloqueo optimista entre dos administradores que editan a la vez (gana la última escritura)"
  - "Cambios a schema.prisma o migraciones (el modelo es de F1; si hiciera falta, se pregunta)"
tests_requeridos_total: 26
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/settings/**, apps/web/src/features/settings/**, apps/web/src/shared/ticket/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 5: Ajustes — sucursal y cajas

## 1. Contexto y alcance

Referencias: plan §1.2 (Ajustes), §3 (convenciones), §4.2 (`Branch`, `CashRegister`), §4.3 (umbral de stock bajo "editable en Ajustes"), §6.2 (`settings.branch`, `settings.registers`), §7.2 (ticket), §8 Fase 5 y §13.1 (MXN e IVA). Se apoya en F1 (modelo, `BranchDto`, `CashRegisterDto`, `BasisPoints`, `NonNegativeInt`, `applyBasisPoints`), F2 (acceso por ruta, `branchContext`, `POST /uploads/branch-images`, `AuditService`), F3 (`apiFetch`, guards, `useBranch`, `PrintLayout`, `QrCode`, `ResponsiveDialog`, `notify`, formato de fechas) y F4 (patrón de `PATCH` estricto e idempotente y audit con cambios).

**Objetivo:** configurar los datos de la sucursal que aparecen en el ticket y en la operación, y editar las cajas. Al terminar F5:

- quien tenga `settings.branch` edita los datos fiscales y de contacto, las imágenes, el encabezado y el pie del ticket, el QR de promoción, la zona horaria, los impuestos y el umbral de stock bajo de su sucursal;
- una **vista previa en vivo del ticket** muestra los cambios mientras se escriben, en 80 y 58 mm, y se puede imprimir como prueba;
- quien tenga `settings.registers` ve las cajas de su sucursal y edita su nombre y código;
- todo cambio queda en el audit con el valor anterior y el nuevo.

**Alcance (entra):**

1. Contratos de ajustes en `shared` y la regla de impresión del QR de promoción.
2. Endpoints de sucursal y de cajas.
3. Soporte de `FormData` en `apiFetch` (extensión de F3) para subir imágenes.
4. UI de Ajustes: pestañas, formulario de sucursal con imágenes, vista previa del ticket y lista de cajas.
5. Componentes `TicketHeader`, `TicketFooter` y `PromoBlock`, que reutilizará el ticket real de F8.

**Fuera de alcance:** ver la cabecera. **Extensión declarada de F3:** `apiFetch` acepta `FormData` (§3). Es el único cambio permitido sobre entregables de F3, y sus tests T1–T7 siguen en verde.

---

## 2. Modelo de datos afectado

Sin cambios de schema. Usa `Branch` y `CashRegister` de F1 §4.2, con el cambio del 2026-10-03: `promoQrText` (contenido del QR, que dibuja la app) y `promoQrCaption` (descripción impresa), sin `promoQrImageUrl`.

| Campo | Regla en F5 |
|---|---|
| `Branch.code` | Solo lectura (prefijo de folios). |
| `Branch.currency` | Solo lectura (MXN, §13.1). |
| `Branch.isActive` | Solo lectura. |
| `Branch.imageUrl` | Foto de la sucursal; se muestra en Ajustes. No va en el ticket. |
| `Branch.logoUrl` | Logo; va en el encabezado del ticket. |
| `Branch.taxRateBp`, `pricesIncludeTax` | Editables. Las ventas ya guardadas conservan su copia (F1 §4.6), así que el cambio solo aplica a ventas nuevas. |
| `Branch.timezone` | Editable. Define el "día actual" de reportes y cortes (F9); un cambio afecta también la agrupación de ventas pasadas. |
| `Branch.lowStockThreshold` | Editable (plan §4.3). |
| `CashRegister.code`, `name` | Editables. `code` es único por sucursal. |
| `CashRegister.branchId`, `isActive` | Solo lectura. |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulo | `apps/api/src/modules/settings/` con `branches.routes.ts`, `cashRegisters.routes.ts`, `settings.service.ts` y `settings.repository.ts`. Tag de Swagger `settings`. |
| Acceso a la sucursal | `GET` y `PATCH /branches/:id` exigen `settings.branch`, y además que `:id` esté en los `branchIds` del token. Si no está → 403 `BRANCH_FORBIDDEN`, aunque el id no exista, para no revelar qué ids existen. `:id` no UUID → 400. |
| Acceso a las cajas | `GET /cash-registers` es `branchScoped` (F2): devuelve las cajas de `request.branchId`, ordenadas por `code`. `GET` y `PATCH /cash-registers/:id`: inexistente → 404; de una sucursal fuera de los `branchIds` del actor → 403 `BRANCH_FORBIDDEN`. Todas exigen `settings.registers`. |
| `PATCH` | Esquema estricto (una clave desconocida o de solo lectura → 400) con al menos un campo. Responde el DTO actualizado. Si ningún valor cambia → 200 sin escribir ni auditar (como F4). Gana la última escritura. |
| Textos opcionales | Se recortan (`trim`), y la cadena vacía se guarda como `null`, para que vaciar un campo en el formulario lo borre. |
| Imágenes | Se suben con `POST /uploads/branch-images` (F2) y la URL resultante se guarda con el `PATCH`. `imageUrl` y `logoUrl` aceptan solo `^/uploads/branch/[0-9a-f-]{36}\.webp$` (la imagen normal, no la miniatura) o `null`. La API no comprueba que el archivo exista (la interfaz `StorageService` de F2 no lo permite). La imagen reemplazada no se borra (fuera de alcance). |
| RFC | `taxId`: trim + mayúsculas, formato `^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$` (12 caracteres persona moral, 13 persona física). No se valida el dígito verificador. |
| Zona horaria | `isValidTimeZone(tz)` en `shared`: `new Intl.DateTimeFormat('es-MX', { timeZone: tz })` no lanza. La UI ofrece primero las zonas de México (`America/Mexico_City`, `Cancun`, `Merida`, `Monterrey`, `Chihuahua`, `Hermosillo`, `Mazatlan`, `Tijuana`) y luego "Otras" desde `Intl.supportedValuesOf('timeZone')`. |
| IVA en la UI | Se captura como porcentaje con hasta 2 decimales (`16` → 1600, `16.5` → 1650) y se guarda en puntos base (`BasisPoints`, 0–10000). |
| QR de promoción | `promoBlock(branch)` en `shared` decide qué se imprime (§8). El QR se dibuja con `QrCode` de F3 (corrección `M`) a partir de `toPromoQrPayload(promoQrText)` (F1 §6.8): un enlace va tal cual (el celular del cliente lo abre) y cualquier otro texto, como `PROMO:<texto>`. Al escanearlo, `classifyScan` lo reconoce como `promo`: el POS (F8) muestra el texto y, con `pos.discount`, ofrece aplicar el descuento a mano. El código no se valida. |
| Componentes del ticket | `apps/web/src/shared/ticket/`: `TicketHeader` (logo, nombre, razón social, RFC, dirección, teléfono, `ticketHeader`), `TicketFooter` (`ticketFooterMessage` + `PromoBlock`) y `PromoBlock`. Reciben un `BranchDto` (o los valores del formulario) y un ancho (`80` \| `58`). F8 los reutiliza para el ticket real. |
| Vista previa | `TicketPreview` en `features/settings/` = `TicketHeader` + cuerpo de ejemplo + `TicketFooter`, dentro de un contenedor de 72 mm (80) o 48 mm (58). Lee los valores **sin guardar** del formulario (`watch()`), así que se actualiza mientras se escribe. Muestra "— Vista previa —" arriba. |
| Cuerpo de ejemplo | Folio `S1-000000`, la fecha y hora actual en la zona horaria del formulario, el cajero (`me.user.fullName`), 2 partidas ficticias (`Zapato de piel dama 25 Negro` 1 × $899.00 y `Cinturón de piel` 1 × $349.00), subtotal, IVA, total y pago en efectivo con cambio. |
| Totales de la vista previa | `previewTotals(lines, taxRateBp, pricesIncludeTax)` en `features/settings/`. Con IVA incluido: `total = Σ líneas`, `iva = total − round(total × 10000 / (10000 + bp))`. Sin IVA incluido: `iva = applyBasisPoints(subtotal, bp)` y `total = subtotal + iva`. Es **provisional**: F8 define las reglas definitivas y reemplaza este cálculo. |
| Imprimir prueba | El botón "Imprimir prueba" envuelve la vista previa en `PrintLayout` (`ticket-80` o `ticket-58`) y llama a `usePrint()` (F3). |
| `apiFetch` con `FormData` | Si `body` es `FormData`, se envía sin serializar y sin `Content-Type` (el navegador agrega el *boundary*). El resto del comportamiento de F3 no cambia. |
| Rutas web | `/settings` (guard `anyOf` `settings.branch`/`settings.registers`, F3) redirige a la primera pestaña permitida: `/settings/branch` (`settings.branch`) o `/settings/registers` (`settings.registers`). Una pestaña sin permiso → `NoAccessPage`. |
| Sucursal editada | La de `useBranch()` (F3), es decir, la sucursal actual. |
| Datos en sesión | Si cambia el nombre de la sucursal, el header (que lee `me.branches`) lo muestra tras el siguiente refresh (≤ 15 min); la pantalla de Ajustes lo muestra al instante. |
| Formularios | React Hook Form + `zodResolver` con los esquemas de `shared`. Se envían solo los campos modificados (`dirtyFields`). Un `VALIDATION_ERROR` se asigna a los campos por `details[].path`. |
| Audit | `AuditService.record` en la misma transacción, con `entity` `Branch` o `CashRegister`, `entityId` e ip. Acciones `branch.update` y `cash_register.update`, con `payload: { changes: { campo: { from, to } } }` solo de los campos que cambiaron. |
| Consultas en la web | TanStack Query con las claves `['branch', id]` y `['cash-registers', branchId]`; las mutaciones las invalidan. |

---

## 4. Dependencias autorizadas (lista cerrada)

Ninguna nueva.

---

## 5. Contratos en `packages/shared` (`settings.ts`, nuevo)

```ts
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

export const TaxIdSchema = z.string().trim().toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/, 'RFC no válido');

export const BranchImageUrl = z.string()
  .regex(/^\/uploads\/branch\/[0-9a-f-]{36}\.webp$/, 'Imagen no válida').nullable();

export function isValidTimeZone(tz: string): boolean;
export const TimeZoneSchema = z.string().refine(isValidTimeZone, 'Zona horaria no válida');

export const BranchUpdateInput = z.strictObject({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120).optional(),
  legalName: optionalText(200).optional(),
  taxId: z.union([TaxIdSchema, z.literal('').transform(() => null)]).nullable().optional(),
  address: optionalText(300).optional(),
  phone: optionalText(30).optional(),
  email: z.union([z.email('Correo no válido'), z.literal('').transform(() => null)]).nullable().optional(),
  imageUrl: BranchImageUrl.optional(),
  logoUrl: BranchImageUrl.optional(),
  ticketHeader: optionalText(500).optional(),
  ticketFooterMessage: optionalText(500).optional(),
  promoQrText: optionalText(300).optional(),
  promoQrCaption: optionalText(200).optional(),
  timezone: TimeZoneSchema.optional(),
  taxRateBp: BasisPoints.optional(),
  pricesIncludeTax: z.boolean().optional(),
  lowStockThreshold: NonNegativeInt.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });

export const CashRegisterCodeSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9-]{1,10}$/, 'El código debe tener de 1 a 10 caracteres: letras, números o guiones');

export const CashRegisterUpdateInput = z.strictObject({
  code: CashRegisterCodeSchema.optional(),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(60).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });

export type PromoBlock =
  | { kind: 'qr'; text: string; payload: string; caption: string | null }   // payload = toPromoQrPayload(text)
  | { kind: 'message'; caption: string }
  | null;
export function promoBlock(b: { promoQrText: string | null; promoQrCaption: string | null }): PromoBlock;
```

`BranchDto` y `CashRegisterDto` son de F1. Los tipos se exportan con `z.infer`. No hay códigos de error nuevos: se usan `VALIDATION_ERROR`, `FORBIDDEN`, `BRANCH_FORBIDDEN`, `NOT_FOUND` y `CONFLICT`.

---

## 6. Endpoints

Todos bajo `/api/v1`, con tag `settings`. Las respuestas de error son `ApiErrorDto`.

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /branches/:id` | `settings.branch` | — | 200 `BranchDto` · 400 · 401 · 403 (`FORBIDDEN`, `BRANCH_FORBIDDEN`) |
| `PATCH /branches/:id` | `settings.branch` | `BranchUpdateInput` | 200 `BranchDto` · 400 · 403 |
| `GET /cash-registers` | `settings.registers`, `branchScoped` | — | 200 `CashRegisterDto[]` · 400 `BRANCH_REQUIRED` · 403 |
| `GET /cash-registers/:id` | `settings.registers` | — | 200 `CashRegisterDto` · 403 · 404 |
| `PATCH /cash-registers/:id` | `settings.registers` | `CashRegisterUpdateInput` | 200 `CashRegisterDto` · 400 · 403 · 404 · 409 `CONFLICT` (`details.target` incluye `code`) |

---

## 7. Pantallas (wireframe en texto)

**Ajustes (`/settings/branch`)**, móvil:

```
┌──────────────────────────────┐
│ Ajustes                      │
│ [ Sucursal ] [ Cajas ]       │  ← solo las pestañas permitidas
├──────────────────────────────┤
│ Datos generales              │
│  Código        S1 (no editable)
│  Nombre        [Sucursal 1__]│
│  Razón social  [____________]│
│  RFC           [____________]│
│  Dirección     [____________]│
│  Teléfono      [____] Correo [____]
│ Imágenes                     │
│  Foto  [🖼 ] [Cambiar] [Quitar]
│  Logo  [🖼 ] [Cambiar] [Quitar]
│ Ticket                       │
│  Encabezado    [____________]│
│  Mensaje final [____________]│
│  QR de promoción             │
│   Texto del QR [____________]│  ← "Se convierte en QR"
│   Descripción  [____________]│  ← "Se imprime debajo del QR"
│ Operación                    │
│  Zona horaria  [America/Mexico_City ▾]
│  IVA (%)       [16.00]       │
│  ☑ Los precios incluyen IVA  │
│  ⚠ Aplica a ventas nuevas; las anteriores conservan su IVA.
│  Stock bajo    [2] unidades  │
├──────────────────────────────┤
│ [Vista previa]   [ Guardar ] │  ← barra fija; "Vista previa" abre hoja inferior
└──────────────────────────────┘
```

En escritorio, la vista previa va a la derecha del formulario, siempre visible. El aviso de IVA y zona horaria solo aparece si esos campos cambiaron.

**Vista previa del ticket** (80 mm; 58 mm con el selector):

```
  [ 80 mm | 58 mm ]   [Imprimir prueba]
  ┌────────────────────────┐
  │    — Vista previa —    │
  │        [ LOGO ]        │
  │      Sucursal 1        │
  │  Calzado Ejemplo SA..  │
  │  RFC: ABC010101AB1     │
  │  Av. Siempre Viva 123  │
  │  Tel. 55 1234 5678     │
  │  ¡Bienvenido!          │  ← ticketHeader
  │------------------------│
  │ Folio S1-000000        │
  │ 03/10/2026 18:30       │
  │ Cajero: Eliu Castillo  │
  │------------------------│
  │ Zapato de piel dama    │
  │  25 Negro  1 x $899.00 │
  │ Cinturón de piel       │
  │            1 x $349.00 │
  │------------------------│
  │ Total        $1,248.00 │
  │ IVA incluido   $172.14 │
  │ Efectivo     $1,300.00 │
  │ Cambio          $52.00 │
  │------------------------│
  │ Gracias por su compra  │  ← ticketFooterMessage
  │       ▓▓▓▓▓▓▓▓         │
  │       ▓▓ QR ▓▓         │
  │       ▓▓▓▓▓▓▓▓         │
  │ Muestra este QR al     │  ← promoQrCaption
  │ cajero en tu próxima   │
  │ compra                 │
  └────────────────────────┘
```

Con precios sin IVA, los totales se muestran como "Subtotal", "IVA 16 %" y "Total".

**Cajas (`/settings/registers`)**:

```
  Cajas
  ┌────────────────────────────┐
  │ C1 · Caja 1        [Editar]│
  │ C2 · Caja 2        [Editar]│
  └────────────────────────────┘
  (No se pueden agregar ni eliminar cajas.)
```

"Editar" abre un `ResponsiveDialog` con "Código" y "Nombre". Un 409 muestra en "Código" el mensaje "Ya existe una caja con ese código".

---

## 8. Reglas y casos borde

1. **QR de promoción** (`promoBlock`):
   - con `promoQrText` → se imprime el QR, con `promoQrCaption` debajo si existe;
   - solo `promoQrCaption` → se imprime como mensaje, sin QR;
   - ninguno (o solo espacios) → no se imprime nada.
2. **QR con código de descuento:** el QR lleva `PROMO:<código>`. Al escanearlo, el sistema lo reconoce como promoción y el POS muestra el código (F8), pero no lo valida: el cajero aplica el descuento a mano con `pos.discount`.
   - **Texto que es un enlace** (`http://`, `https://` o `www.`): el QR lleva el enlace sin prefijo, para que el celular del cliente lo abra; al escanearlo en el sistema, también se reconoce como promoción.
3. **Cambio de IVA o de "precios incluyen IVA":** solo afecta ventas nuevas; cada venta guarda su copia (F1).
4. **Cambio de zona horaria:** afecta cómo se agrupan por día las ventas en reportes y cortes (F9), también las pasadas. La UI lo advierte.
5. **Campo vaciado** en el formulario → se guarda `null`.
6. **`PATCH` con `code`, `currency`, `isActive` o cualquier clave desconocida** → 400 `VALIDATION_ERROR`, sin escrituras.
7. **URL de imagen** que no es `/uploads/branch/<uuid>.webp` (miniatura, otra entidad o URL externa) → 400 en ese campo.
8. **Código de caja duplicado** en la misma sucursal → 409; el mismo código en otra sucursal es válido.
9. **Sucursal o caja fuera de las sucursales del actor** → 403 `BRANCH_FORBIDDEN`.
10. **`PATCH` sin cambios reales** → 200 sin escritura ni audit.
11. **Dos administradores editan a la vez:** gana la última escritura (sin bloqueo optimista en el MVP).
12. **Vendedor en el POS:** no puede leer `GET /branches/:id` (requiere `settings.branch`). F8 define cómo obtiene los datos del ticket.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Contratos.**
  - Crear `shared/settings.ts` (esquemas, `isValidTimeZone` y `promoBlock`). Tests **T1–T5**.
  - *Verificable:* T1–T5 en verde.
- [ ] **2. API: sucursal.**
  - `settings.repository.ts`, `settings.service.ts` y `branches.routes.ts`; registrar en `app.ts`; helper de test `createSaleFixture`. Tests **T6–T10**.
  - *Verificable:* T6–T10 en verde.
- [ ] **3. API: cajas.**
  - `cashRegisters.routes.ts` y su servicio. Tests **T11–T14**.
  - *Verificable:* T11–T14 en verde.
- [ ] **4. `apiFetch` con `FormData`.**
  - Extender `apiClient.ts` (§3). Test **T15**; T1–T7 de F3 siguen en verde.
  - *Verificable:* T15 y los tests de F3 en verde.
- [ ] **5. UI: página y pestañas.**
  - `SettingsPage`, rutas `/settings/*` y hooks de datos. Test **T16**.
  - *Verificable:* T16 en verde.
- [ ] **6. UI: formulario de sucursal.**
  - `BranchSettingsForm`, `BranchImageField` y la captura de IVA y zona horaria. Tests **T17–T19**.
  - *Verificable:* T17–T19 en verde.
- [ ] **7. UI: ticket y vista previa.**
  - `shared/ticket/` (`TicketHeader`, `TicketFooter`, `PromoBlock`), `previewTotals`, `TicketPreview` y "Imprimir prueba". Tests **T20–T24**.
  - *Verificable:* T20–T24 en verde.
- [ ] **8. UI: cajas.**
  - `CashRegistersTab` y su diálogo de edición. Tests **T25–T26**.
  - *Verificable:* T25–T26 en verde.
- [ ] **9. README y cierre.**
  - En el README: Ajustes, cómo subir el logo y la configuración del QR de promoción.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales (§11); registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 26)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (`owner`, `admin`, los 5 roles, y las sucursales `S1` y `S2`, cada una con `C1` y `C2`). Los de `web` usan Jest + RTL con `fetch` simulado.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `settings.test.ts` | `BranchUpdateInput`: parcial válido; `{}` → "Debes cambiar al menos un campo"; `code`, `currency`, `isActive` y una clave desconocida → error (estricto); `"   "` en un texto opcional → `null`; correo inválido, `taxRateBp: 10001` y `lowStockThreshold: -1` → error. |
| T2 | `shared` · `settings.test.ts` | `TaxIdSchema` (`it.each`): `"xaxx010101000"` → `"XAXX010101000"`; `"ABC010101AB1"` válido; `"ABC123"` y `"ABCD0101011234"` → error. `BranchImageUrl`: `/uploads/branch/<uuid>.webp` válido; la miniatura `.thumb.webp`, `/uploads/product/<uuid>.webp` y `https://x.com/a.webp` → error; `null` válido. |
| T3 | `shared` · `settings.test.ts` | `CashRegisterUpdateInput`: `" c3 "` → `"C3"`; `"C 3"` y 11 caracteres → error; nombre vacío → error; `{}` → error; `branchId` → error (estricto). |
| T4 | `shared` · `settings.test.ts` | `promoBlock` (`it.each`): texto + descripción → `qr` con `caption`; solo texto → `qr` con `caption: null`; `"DESC10"` → `payload: "PROMO:DESC10"` y `"www.ejemplo.com"` → `payload` sin cambio; solo descripción → `message`; ninguno → `null`; solo espacios → `null`. |
| T5 | `shared` · `settings.test.ts` | `isValidTimeZone`: `America/Mexico_City`, `America/Cancun` y `UTC` → `true`; `Mars/Phobos` y `""` → `false`. |
| T6 | `int` · `settings-branch.int.test.ts` | `GET /branches/:id`: OWNER y ADMIN → 200 `BranchDto` válido; SELLER con `settings.branch` extra → 200; SELLER sin él → 403 `FORBIDDEN`; una segunda sucursal creada en el test y no asignada al actor → 403 `BRANCH_FORBIDDEN`; un UUID inexistente → 403 `BRANCH_FORBIDDEN`; id no UUID → 400. |
| T7 | `int` · `settings-branch.int.test.ts` | `PATCH` cambia nombre, datos fiscales, `ticketHeader`, `promoQrText`, `promoQrCaption`, `timezone`, `taxRateBp`, `pricesIncludeTax` y `lowStockThreshold`, y responde el `BranchDto` nuevo con `updatedAt` mayor. `""` en `legalName` guarda `null`. Repetir el mismo `PATCH` → 200 sin cambiar `updatedAt` ni crear `AuditLog`. |
| T8 | `int` · `settings-branch.int.test.ts` | `PATCH` con `code`, `currency` o `isActive` → 400; `timezone: 'Mars/Phobos'` → 400 con `path` `timezone`; `logoUrl` de producto o externa → 400 con `path` `logoUrl`; `taxRateBp: 10001` → 400. Ningún caso escribe en BD. |
| T9 | `int` · `settings-branch.int.test.ts` | Tras un `PATCH` de `name` y `taxRateBp`, hay un `AuditLog` `branch.update` con `userId` del actor, `entity: 'Branch'`, `entityId`, ip y `payload.changes` con solo esos dos campos (`from` y `to`). |
| T10 | `int` · `settings-branch.int.test.ts` | Con una venta existente (`createSaleFixture`, `taxRateBp` 1600 e IVA incluido), un `PATCH` a `taxRateBp: 800` y `pricesIncludeTax: false` no cambia la `Sale` guardada. |
| T11 | `int` · `settings-registers.int.test.ts` | `GET /cash-registers` → `C1` y `C2` de `S1`, ordenadas por `code`; las cajas de otra sucursal no aparecen; `X-Branch-Id` de una sucursal no asignada → 403 `BRANCH_FORBIDDEN`; sin `settings.registers` → 403 `FORBIDDEN`. |
| T12 | `int` · `settings-registers.int.test.ts` | `GET /cash-registers/:id` → 200 `CashRegisterDto`; inexistente → 404 `NOT_FOUND`; caja de una sucursal no asignada → 403 `BRANCH_FORBIDDEN`. |
| T13 | `int` · `settings-registers.int.test.ts` | `PATCH` cambia `name` y `code` (normalizado a mayúsculas) y crea un `AuditLog` `cash_register.update` con los cambios; `code` igual al de otra caja de `S1` → 409 `CONFLICT` con `details.target` que incluye `code`; el mismo código en otra sucursal → 200; `branchId` en el body → 400. |
| T14 | `int` · `settings-access.int.test.ts` | Un usuario con solo `settings.branch` → 403 en las rutas de cajas; uno con solo `settings.registers` → 403 en las de sucursal. `/api/docs/json` agrupa las 5 rutas bajo el tag `settings` con `security`. |
| T15 | `web` · `shared/api/apiClient.test.ts` | Con `body: FormData`, `fetch` recibe el mismo `FormData`, sin `Content-Type` propio, y conserva `Authorization` y `X-Branch-Id`. Un body objeto se sigue serializando a JSON. |
| T16 | `web` · `SettingsPage.test.tsx` | `it.each` de permisos: solo `settings.branch` → solo la pestaña "Sucursal"; solo `settings.registers` → solo "Cajas"; ambos → las dos. `/settings` redirige a la primera permitida; `/settings/registers` sin su permiso → "No tienes permiso para ver esta sección.". |
| T17 | `web` · `BranchSettingsForm.test.tsx` | Carga el `BranchDto` de la sucursal actual; "Código" es de solo lectura; al guardar envía solo los campos modificados; un 400 con `details[].path: 'taxId'` muestra el error en "RFC"; el éxito muestra un *toast* e invalida `['branch', id]`. |
| T18 | `web` · `BranchSettingsForm.test.tsx` | IVA: `16` → `taxRateBp: 1600`, `16.5` → 1650, `101` → error de validación sin llamar a la API. El aviso "Aplica a ventas nuevas…" aparece solo si cambian el IVA, "precios incluyen IVA" o la zona horaria. Las zonas de México aparecen primero. |
| T19 | `web` · `BranchImageField.test.tsx` | Elegir un archivo llama a `POST /api/v1/uploads/branch-images` con `FormData`, guarda la `url` en el campo y muestra la imagen; "Quitar" deja el campo en `null`; un 413 o 415 muestra el `message` de la API. |
| T20 | `web` · `TicketPreview.test.tsx` | Mientras se escribe (antes de guardar), el texto de `ticketHeader`, el nombre y el mensaje final aparecen en la vista previa; con `logoUrl` se muestra el logo; muestra "— Vista previa —", el folio `S1-000000` y el cajero. |
| T21 | `web` · `PromoBlock.test.tsx` | `it.each` de las 3 reglas de §8.1: QR + descripción; solo QR; solo mensaje; nada. El `QrCode` recibe el `payload` (`PROMO:DESC10` para un código y el enlace tal cual para `https://ejemplo.com`), y debajo se ve el texto sin prefijo. |
| T22 | `web` · `TicketPreview.test.tsx` | Con IVA incluido muestra "Total" e "IVA incluido"; sin IVA incluido muestra "Subtotal", "IVA 16 %" y "Total", con los montos de `previewTotals`; la fecha usa la zona horaria del formulario. |
| T23 | `web` · `previewTotals.test.ts` | Líneas de 89900 y 34900 con 1600 bp: IVA incluido → total 124800 e IVA 17214; sin IVA → subtotal 124800, IVA 19968 y total 144768. Con 0 bp → IVA 0. |
| T24 | `web` · `TicketPreview.test.tsx` | El selector 80/58 cambia el ancho del contenido a 72 mm o 48 mm; "Imprimir prueba" monta `PrintLayout` con `ticket-80` o `ticket-58` y llama a `window.print` (simulado). |
| T25 | `web` · `CashRegistersTab.test.tsx` | Lista las cajas de la sucursal actual y la nota "No se pueden agregar ni eliminar cajas"; no hay botón para agregar. |
| T26 | `web` · `CashRegistersTab.test.tsx` | "Editar" abre el diálogo; guardar envía `CashRegisterUpdateInput` y actualiza la lista; un 409 muestra "Ya existe una caja con ese código" en "Código" sin cerrar el diálogo. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F4 siguen en verde.

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Los cambios de la sucursal se reflejan en la vista previa del ticket mientras se escriben. | T20–T22 |
| CA2 | Sin el permiso correspondiente, la sección no es visible y la API responde 403. | T6, T11, T14, T16 |
| CA3 | Cambiar el IVA no altera las ventas ya registradas. | T10 |
| CA4 | El QR de promoción se genera desde el texto, con su descripción, según las reglas de §8.1. | T4, T21 + verificación manual con un ticket de prueba impreso: un QR de enlace se abre con la cámara del celular; un QR de código, leído con el lector en `/dev/scanner`, aparece como `promo` con su texto |
| CA5 | "Imprimir prueba" en la Epson TM-T20III (80 mm) produce un ticket legible con logo, textos y QR, sin márgenes recortados. | Verificación manual (fecha y responsable en §12) |
| CA6 | Las cajas se editan (nombre y código) sin poder agregar ni eliminar, y el código no se repite en la sucursal. | T13, T25, T26 |
| CA7 | Toda edición queda en el audit con el valor anterior y el nuevo. | T9, T13 |
| CA8 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F4. | Salida de los comandos en §12 |
| CA9 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |

El criterio del plan "los cambios se reflejan después en los tickets reales" se verifica al cerrar F8, que reutiliza `TicketHeader` y `TicketFooter`.

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-03 | El QR de promoción se genera desde un texto (`promoQrText`), con una descripción opcional debajo (`promoQrCaption`). Se quita `promoQrImageUrl`. | Usuario (chat); F1 §4.2 y plan §4.2 y §8 F5 actualizados |
| 2026-10-03 | Si el QR es un código de descuento, el sistema no lo valida; el cajero lo aplica a mano. Los cupones validados por el sistema quedan post-MVP. | Usuario (chat); plan §8 F5 y §11 actualizados |
| 2026-10-03 | La descripción del QR es opcional: solo descripción → mensaje sin QR; ninguno → nada. | Usuario (chat) |
| 2026-10-03 | El QR de promoción se reconoce al escanearlo: un enlace va tal cual y cualquier otro texto, como `PROMO:<texto>` (`toPromoQrPayload`, F1 §6.8). En el POS, una lectura `promo` muestra el texto y, con `pos.discount`, ofrece aplicar el descuento a mano. | Usuario (chat); F1 §6.8, F3 §4 y plan §5.3, §7.1, §8 F5, §8 F8 y §11 actualizados |
| 2026-10-03 | `lowStockThreshold` se edita en Ajustes, como ya indicaba plan §4.3. | Plan §4.3; plan §8 F5 actualizado |
| 2026-10-03 | Se agrega `GET /cash-registers` (lista de la sucursal actual), porque la UI del plan pide una lista de cajas. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `Branch.code`, `currency` e `isActive` son de solo lectura; `CashRegister.code` sí se edita (el plan lo pide y no se usa en folios). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | El acceso a una sucursal exige que esté en los `branchIds` del actor (`BRANCH_FORBIDDEN`), también si el id no existe. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | RFC con formato estándar (12/13 caracteres) sin dígito verificador; código de caja `^[A-Z0-9-]{1,10}$`; zona horaria validada con `Intl`; IVA capturado en % y guardado en puntos base. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Las URL de imagen solo aceptan `/uploads/branch/<uuid>.webp`; no se verifica el archivo ni se borra el reemplazado. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `TicketHeader`, `TicketFooter` y `PromoBlock` en `apps/web/src/shared/ticket/` para que F8 los reutilice; la vista previa usa partidas de ejemplo y un cálculo de IVA provisional que F8 reemplaza. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `apiFetch` acepta `FormData` (extensión declarada de F3). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `PATCH` estricto, idempotente y con audit de cambios, como F4. Gana la última escritura. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Los datos del ticket para el vendedor del POS (sin `settings.branch`) los resuelve F8. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
| 2026-10-03 | El seed crea una segunda sucursal `S2` con sus cajas `C1`/`C2`; en T11 y T13, "otra sucursal" puede ser `S2`. | Usuario (chat), durante la revisión de F6; F1 §7.2 actualizado |
