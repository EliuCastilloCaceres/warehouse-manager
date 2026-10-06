---
id: fase-01
titulo: Modelo de datos y contratos compartidos
estado: LISTA
depende_de: [fase-00]
autoriza_codigo_en:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - "eslint.config.js"
  - ".prettierignore"
  - ".gitignore"
  - ".env.example"
  - "README.md"
  - "infra/docker-compose.dev.yml"
  - "apps/api/package.json"
  - "apps/api/tsconfig*.json"
  - "apps/api/jest.config.cjs"
  - "apps/api/prisma.config.ts"
  - "apps/api/prisma/**"
  - "apps/api/src/core/password.ts"
  - "apps/api/src/core/password.test.ts"
  - "apps/api/src/core/prisma-client.ts"
  - "apps/api/test/**"
  - "packages/shared/**"
  - "docs/erd.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Plugin Fastify `prisma`, chequeo de BD en /health y cualquier uso de la BD desde la API en ejecución (F2)"
  - "InventoryService y cualquier escritura de stock_location o inventory_movement fuera de los tests de restricciones (F2/F7)"
  - "Esquemas de entrada Create/Update/ListQuery de los módulos (cada spec F4–F9, con su endpoint)"
  - "DTOs compuestos (producto con variantes, venta con partidas, árbol de almacén, etc.) (F4–F9)"
  - "Stock en el seed de demo (F7, vía InventoryService)"
  - "Generador de SKU de variante sugerido {SKU_PADRE}-{TALLA}-{COLOR3} (F6)"
  - "Utilidad de nivel de ocupación verde/ámbar/rojo (F7) y cálculo de impuestos de venta (F8)"
  - "Flujo y endpoint de cancelación de venta (F8); en F1 solo existen campos, enum y permiso"
  - "Valores SUPPLIER/CUSTOMER de UserType y cualquier entidad del roadmap §11"
  - "Endpoints, pantallas y cambios en apps/web"
  - "Generadores de ERD (decisión 2026-10-01: mermaid a mano)"
tests_requeridos_total: 26
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en packages/shared y en apps/api/prisma/seed/** + apps/api/src/core/password.ts"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 1: Modelo de datos y contratos compartidos

## 1. Contexto y alcance

Referencias: plan §3 (convenciones), §4 (modelo y reglas), §5 (códigos de ubicación), §6.2 (permisos), §8 Fase 1, §9 (pruebas), §13 (preguntas respondidas el 2026-10-01).

**Objetivo:** definir **una sola vez** el modelo de datos completo del MVP en Prisma + SQL, con sus garantías en BD, y los contratos de lectura que comparten `api` y `web`. Al terminar F1:

- `schema.prisma` contiene todas las entidades del MVP, con índices, uniques y `onDelete` explícitos;
- una migración SQL complementaria agrega lo que Prisma no expresa: `CHECK`, índices parciales o `NULLS NOT DISTINCT`, el trigger que hace inmutable al kardex y la vista `v_rack_occupancy`;
- el seed base es idempotente y el seed de demo crea estructura y catálogo sin stock;
- `packages/shared` expone enums, permisos, roles del sistema, utilidades (`money`, `sku`, `locationCode`, `scanClassifier`), error estándar, paginación y un `Dto` por entidad;
- tests de paridad garantizan que `shared` y Prisma no diverjan;
- una BD de pruebas en Docker permite verificar migraciones, restricciones y seed con tests automáticos.

**Alcance (entra):**

1. Prisma (cliente, CLI y adaptador `pg`), `prisma.config.ts` y el cliente generado.
2. `schema.prisma` completo (§4) y la migración `init`.
3. Migración `constraints` con SQL manual (§5).
4. Seed base y seed de demo (§7).
5. `packages/shared`: enums, permisos, utilidades, errores, paginación y DTOs (§6).
6. `apps/api/src/core/password.ts` (argon2id), que usan el seed ahora y `auth` en F2.
7. `apps/api/src/core/prisma-client.ts` (`createPrismaClient(url)`), que usan el seed y los tests ahora y el plugin `prisma` en F2.
8. Servicio `postgres-test` y tests de integración contra BD real.
9. `docs/erd.md` con el ERD en mermaid, mantenido a mano.

**Fuera de alcance:** ver `fuera_de_alcance` en la cabecera. La API en ejecución **no** se conecta a la BD en F1; solo lo hacen la CLI de Prisma, los seeds y los tests.

---

## 2. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Prisma | Última estable (≥ 7) al instalar. Generador `prisma-client` con `output = "../src/generated/prisma"`. Runtime con el adaptador `@prisma/adapter-pg`. El cliente generado no se versiona (`.gitignore`) y se regenera con `postinstall` y antes de `build`/`typecheck`. |
| `prisma.config.ts` | En `apps/api`. Define la ruta del schema, la de las migraciones, el comando de seed (`tsx prisma/seed.ts`) y `datasource.url` desde `DATABASE_URL`. Carga el `.env` de la raíz con `process.loadEnvFile` (Node 24) solo si existe, así que no se agrega `dotenv`. `prisma generate` debe funcionar **sin** `DATABASE_URL`. |
| Cliente | `createPrismaClient(databaseUrl: string): PrismaClient` en `src/core/prisma-client.ts`. Es el único lugar que construye el cliente. |
| Mapeo de nombres | Modelos en PascalCase con `@@map` a snake_case singular. `User` se mapea a `app_user` porque `user` es palabra reservada en PostgreSQL. Los campos de más de una palabra llevan `@map` a snake_case. |
| Identificadores | `String @id @db.Uuid @default(dbgenerated("gen_random_uuid()"))`, que sirve también para inserts por SQL crudo. Las FK son `@db.Uuid`. Las tablas puente y `BranchCounter` usan llave compuesta. |
| Fechas | `DateTime @db.Timestamptz(3)`. Las tablas mutables tienen `createdAt @default(now())` y `updatedAt @updatedAt`. Las inmutables (`InventoryMovement`, `AuditLog`, `SaleItem`, `Payment` y las tablas puente) solo tienen `createdAt`. |
| Textos | `text` en BD, salvo `currency` (`Char(3)`). Las longitudes máximas se validan en los esquemas de entrada de cada módulo (F4–F9), no en la BD. |
| Dinero | `Int` (centavos, 32 bits). En `shared`, `MoneyCents` acota a `0…2 147 483 647`. |
| Enums | Enums de PostgreSQL vía Prisma, con `@@map` a snake_case. Las mismas listas existen como `z.enum` en `shared`, y T14 verifica que coincidan. |
| `onDelete` | `Restrict` por defecto. `Cascade` solo en: `RolePermission` (→ `Role`, → `Permission`), `UserPermission` (→ `Permission`), `ProductVariant` → `Product`, `ProductImage` → `Product` y `CartItem` → `Cart`. `SetNull` en `ProductImage.variantId`. |
| Migraciones | Dos: `init` (generada por Prisma) y `constraints` (creada con `prisma migrate dev --create-only` y escrita a mano). Una migración aplicada no se edita: los cambios van en migraciones nuevas. |
| Drift | Después de aplicar las migraciones, `prisma migrate diff` (BD migrada contra `schema.prisma`, con `--exit-code`) no debe reportar diferencias (T16). Así se detecta si Prisma intenta borrar un índice manual. |
| `created_by_id` | No se agrega a las entidades. La autoría queda en `AuditLog` y en los campos que el plan ya define (`openedById`, `sellerId`, `cashierId`, `userId`, etc.). |
| Contraseñas | argon2id (`argon2`) con `memoryCost 19456` KiB, `timeCost 2` y `parallelism 1` (mínimo de OWASP). |
| BD de pruebas | Servicio `postgres-test` (puerto 5433, `tmpfs`, BD `warehouse_test`). El `globalSetup` de Jest se niega a correr si `TEST_DATABASE_URL` no termina en `_test` o si es igual a `DATABASE_URL`. Después hace `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` y `prisma migrate deploy`. Cada suite limpia con `TRUNCATE … RESTART IDENTITY CASCADE`. |
| Jest en `api` | Dos *projects*: `unit` (`src/**/*.test.ts`, `test/unit/**/*.test.ts`, `test/parity/**/*.test.ts`) e `integration` (`test/integration/**/*.int.test.ts`, con `globalSetup`). `pnpm test` corre ambos con `--runInBand` y requiere `pnpm dev:db`. Si la BD de pruebas no responde, falla con un mensaje en español que indica cómo levantarla. |
| Paridad | Los tests de paridad leen `apps/api/prisma/schema.prisma` como texto, con un parser mínimo en `test/parity/prismaSchema.ts`. No dependen del cliente generado. |

**Comandos de BD autorizados en F1** (constitución §2.3):
- `prisma migrate dev` y `prisma migrate dev --create-only` sobre la BD de **desarrollo**;
- `prisma migrate reset` sobre la BD de desarrollo, solo con confirmación del usuario en el chat;
- el reseteo de la BD de **pruebas** que hace el `globalSetup`, con las guardas descritas arriba;
- `pnpm db:seed` y `pnpm seed:demo` sobre la BD de desarrollo.

---

## 3. Dependencias autorizadas (lista cerrada)

| Paquete | Dependencias | DevDependencies |
|---|---|---|
| `apps/api` | `@prisma/client`, `@prisma/adapter-pg`, `argon2` | `prisma` |
| `packages/shared` | — (solo `zod`, ya presente) | — |

`pnpm-workspace.yaml` agrega `argon2`, `prisma`, `@prisma/engines` y `@prisma/client` a `onlyBuiltDependencies`, porque pnpm 10 bloquea sus scripts de instalación. Si el adaptador exige declarar `pg` o `@types/pg` explícitamente, se pregunta antes (P2).

---

## 4. Modelo de datos (`apps/api/prisma/schema.prisma`)

El listado omite, por brevedad, las anotaciones obligatorias de §2: `@@map`/`@map`, `@db.Uuid`, `@db.Timestamptz(3)` y el `@default` de los ids. Las relaciones inversas se nombran en plural.

### 4.1 Enums

```prisma
enum UserType               { STAFF }
enum ProductType            { SIMPLE VARIABLE }
enum InventoryMovementType  { INITIAL_LOAD PUTAWAY RELOCATE PICK RETURN_TO_RACK TO_STAGING SALE SALE_CANCEL ADJUSTMENT_IN ADJUSTMENT_OUT }
enum InventoryReferenceType { CART SALE }
enum CashSessionStatus      { OPEN CLOSED }
enum CartStatus             { ACTIVE SUSPENDED CHECKED_OUT DISCARDED }
enum SaleStatus             { COMPLETED CANCELLED }
enum PaymentMethod          { CASH CARD TRANSFER }
enum BranchCounterKey       { SALE_FOLIO }
enum AdjustmentReason       { PHYSICAL_COUNT DAMAGE LOSS FOUND DATA_ENTRY_ERROR OTHER }
```

### 4.2 Organización

```prisma
model Branch {
  id                  String   @id
  code                String   @unique            // "S1"; prefijo de folios
  name                String
  legalName           String?
  taxId               String?                     // RFC
  address             String?
  phone               String?
  email               String?
  imageUrl            String?
  logoUrl             String?
  ticketHeader        String?
  ticketFooterMessage String?
  promoQrText         String?                     // contenido del QR; la app lo dibuja (F5)
  promoQrCaption      String?                     // descripción impresa bajo el QR
  timezone            String   @default("America/Mexico_City")
  currency            String   @default("MXN")    // Char(3)
  taxRateBp           Int      @default(1600)
  pricesIncludeTax    Boolean  @default(true)
  lowStockThreshold   Int      @default(2)
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model BranchCounter {
  branchId  String                                // FK Branch (Restrict)
  key       BranchCounterKey
  value     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@id([branchId, key])
}

model CashRegister {
  id        String   @id
  branchId  String                                // FK Branch (Restrict)
  code      String                                // "C1"
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([branchId, code])
}

model CashSession {
  id             String            @id
  cashRegisterId String                           // FK CashRegister (Restrict)
  openedById     String                           // FK User "CashSessionOpenedBy"
  openedAt       DateTime          @default(now())
  openingAmount  Int
  closedById     String?                          // FK User "CashSessionClosedBy"
  closedAt       DateTime?
  expectedAmount Int?
  countedAmount  Int?
  difference     Int?                             // counted - expected; puede ser negativa
  status         CashSessionStatus @default(OPEN)
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  @@index([cashRegisterId, openedAt])
}
```

### 4.3 Seguridad

```prisma
model User {                                     // @@map("app_user")
  id                 String    @id
  username           String    @unique           // minúsculas (CHECK)
  passwordHash       String
  fullName           String
  email              String?
  phone              String?
  roleId             String                      // FK Role (Restrict)
  type               UserType  @default(STAFF)
  isActive           Boolean   @default(true)
  mustChangePassword Boolean   @default(true)
  lastLoginAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  @@index([roleId])
}

model Role {
  id        String   @id
  code      String   @unique                     // ADMIN | MANAGER | SELLER | WAREHOUSE_CLERK
  name      String
  isSystem  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Permission {
  id          String   @id
  code        String   @unique                   // "products.manage"
  module      String
  description String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model RolePermission {
  roleId       String                            // FK Role (Cascade)
  permissionId String                            // FK Permission (Cascade)
  createdAt    DateTime @default(now())
  @@id([roleId, permissionId])
}

model UserPermission {
  userId       String                            // FK User (Restrict)
  permissionId String                            // FK Permission (Cascade)
  createdAt    DateTime @default(now())
  @@id([userId, permissionId])
}

model UserBranch {
  userId    String                               // FK User (Restrict)
  branchId  String                               // FK Branch (Restrict)
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  @@id([userId, branchId])
  @@index([branchId])
}

model RefreshToken {
  id           String    @id
  userId       String                            // FK User (Restrict)
  tokenHash    String    @unique
  familyId     String                            // @db.Uuid
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?   @unique                 // FK RefreshToken "RefreshTokenRotation" (Restrict)
  userAgent    String?
  ip           String?
  createdAt    DateTime  @default(now())
  @@index([userId])
  @@index([familyId])
}

model AuditLog {
  id        String   @id
  userId    String?                              // FK User (Restrict); null = sistema/seed
  action    String                               // "user.create"
  entity    String                               // "User"
  entityId  String?
  payload   Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([entity, entityId])
  @@index([createdAt])
  @@index([userId])
}
```

### 4.4 Catálogo

```prisma
model Category {
  id        String   @id
  name      String
  parentId  String?                              // FK Category "CategoryTree" (Restrict)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([parentId, name])                     // NULLS NOT DISTINCT en la migración constraints
}

model Brand {
  id        String   @id
  name      String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Product {
  id          String      @id
  sku         String      @unique
  name        String
  description String?
  categoryId  String?                            // FK Category (Restrict)
  brandId     String?                            // FK Brand (Restrict)
  type        ProductType
  price       Int
  cost        Int?
  tags        String[]    @default([])
  isActive    Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  @@index([categoryId])
  @@index([brandId])
  @@index([name])
}

model ProductVariant {
  id            String   @id
  productId     String                           // FK Product (Cascade)
  sku           String   @unique
  barcode       String?  @unique
  size          String?
  color         String?
  material      String?
  priceOverride Int?
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([productId, size, color, material])   // NULLS NOT DISTINCT en la migración constraints
}

model ProductImage {
  id        String   @id
  productId String                               // FK Product (Cascade)
  variantId String?                              // FK ProductVariant (SetNull)
  url       String
  thumbUrl  String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([productId, sortOrder])
  @@index([variantId])
}
```

### 4.5 Almacén

```prisma
model Warehouse {
  id        String   @id
  branchId  String                               // FK Branch (Restrict)
  code      String
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([branchId, code])
}

model Zone {
  id          String   @id
  warehouseId String                             // FK Warehouse (Restrict)
  code        String                             // "A", "AB" o "STG"
  name        String
  color       String?                            // "#RRGGBB"
  isStaging   Boolean  @default(false)
  priority    Int      @default(0)
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([warehouseId, code])
}

model Container {
  id        String   @id
  zoneId    String                               // FK Zone (Restrict)
  code      String                               // "01"–"99"
  name      String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([zoneId, code])
}

model Rack {
  id            String   @id
  containerId   String                           // FK Container (Restrict)
  warehouseId   String                           // FK Warehouse (Restrict); desnormalizado
  code          String                           // "01"–"99"
  locationCode  String                           // "A-01-03"
  capacityUnits Int
  labelColor    String?                          // "#RRGGBB"
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([containerId, code])
  @@unique([warehouseId, locationCode])
}

model StockLocation {
  id          String   @id
  variantId   String                             // FK ProductVariant (Restrict)
  rackId      String                             // FK Rack (Restrict)
  quantity    Int      @default(0)
  reservedQty Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([variantId, rackId])
  @@index([rackId])
}

model InventoryMovement {
  id                 String                  @id
  variantId          String                  // FK ProductVariant (Restrict)
  fromRackId         String?                 // FK Rack "MovementFromRack" (Restrict)
  toRackId           String?                 // FK Rack "MovementToRack" (Restrict)
  quantity           Int
  type               InventoryMovementType
  userId             String                  // FK User (Restrict)
  referenceType      InventoryReferenceType?
  referenceId        String?                 // @db.Uuid
  note               String?
  adjustmentReason   AdjustmentReason?       // solo en ADJUSTMENT_IN/OUT (F7)
  capacityOverridden Boolean                 @default(false)
  createdAt          DateTime                @default(now())
  @@index([variantId, createdAt])
  @@index([fromRackId])
  @@index([toRackId])
  @@index([userId])
  @@index([createdAt])
  @@index([referenceType, referenceId])
}
```

`Rack.warehouseId` debe coincidir con el almacén de su contenedor. En F1 lo garantiza el seed; a partir de F7 lo valida el servicio de estructura, con su test.

**Forma de cada tipo de movimiento** (la impone el `CHECK inventory_movement_shape`):

| Tipo | `fromRackId` | `toRackId` | Efecto (lo aplica `InventoryService` desde F2) |
|---|---|---|---|
| `INITIAL_LOAD`, `PUTAWAY`, `ADJUSTMENT_IN` | null | rack | `quantity` += n en el destino |
| `RETURN_TO_RACK` | null | rack | `reservedQty` −= n en ese rack |
| `SALE_CANCEL` | null | rack de staging | `quantity` += n en staging |
| `PICK` | rack | null | `reservedQty` += n en ese rack |
| `SALE` | rack | null | `quantity` −= n y `reservedQty` −= n |
| `ADJUSTMENT_OUT` | rack | null | `quantity` −= n |
| `RELOCATE`, `TO_STAGING` | rack | rack (distinto) | sale del origen y entra al destino (en `TO_STAGING` también libera la reserva del origen) |

### 4.6 Punto de venta

```prisma
model Cart {
  id            String     @id
  branchId      String                           // FK Branch (Restrict); el carrito es de la sucursal, no de una caja (F8)
  userId        String                           // FK User (Restrict)
  number        Int                              // número corto (1–999), único entre los carritos abiertos de la sucursal (F8)
  status        CartStatus @default(ACTIVE)
  label         String?
  customerName  String?
  discount      Int        @default(0)           // descuento global, centavos
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  @@index([branchId, status])
}

model CartItem {
  id           String   @id
  cartId       String                            // FK Cart (Cascade)
  variantId    String                            // FK ProductVariant (Restrict)
  sourceRackId String                            // FK Rack (Restrict)
  quantity     Int
  unitPrice    Int
  discount     Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([cartId])
  @@index([variantId, sourceRackId])
}

model Sale {
  id               String     @id
  folio            String     @unique            // "S1-000123"
  branchId         String                        // FK Branch (Restrict)
  cashRegisterId   String                        // FK CashRegister (Restrict)
  cashSessionId    String                        // FK CashSession (Restrict)
  sellerId         String                        // FK User "SaleSeller" (Restrict); quien armó el carrito
  cashierId        String                        // FK User "SaleCashier" (Restrict); quien cobró (F8)
  cartId           String     @unique            // FK Cart (Restrict)
  customerName     String?
  subtotal         Int                           // Σ unitPrice × quantity
  globalDiscount   Int        @default(0)
  discountTotal    Int                           // Σ descuentos de partida + globalDiscount
  taxRateBp        Int                           // copia de Branch al vender
  pricesIncludeTax Boolean                       // copia de Branch al vender
  taxTotal         Int
  total            Int
  status           SaleStatus @default(COMPLETED)
  cancelledAt      DateTime?
  cancelledById    String?                       // FK User "SaleCancelledBy" (Restrict)
  cancelReason     String?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  @@index([branchId, createdAt])
  @@index([cashSessionId])
  @@index([sellerId, createdAt])
}

model SaleItem {
  id                   String   @id
  saleId               String                    // FK Sale (Restrict)
  variantId            String                    // FK ProductVariant (Restrict)
  sourceRackId         String                    // FK Rack (Restrict)
  skuSnapshot          String
  nameSnapshot         String
  variantLabelSnapshot String?
  unitPrice            Int
  quantity             Int
  discount             Int      @default(0)
  lineTotal            Int                       // unitPrice × quantity − discount
  createdAt            DateTime @default(now())
  @@index([saleId])
  @@index([variantId])
}

model Payment {
  id        String        @id
  saleId    String                               // FK Sale (Restrict)
  method    PaymentMethod
  amount    Int
  received  Int?                                 // solo CASH
  change    Int?                                 // solo CASH
  reference String?
  createdAt DateTime      @default(now())
  @@index([saleId])
}
```

---

## 5. Migración `constraints` (SQL manual)

Cada restricción lleva el nombre exacto de esta tabla. T17–T20 verifican cada fila.

### 5.1 `CHECK`

| Nombre | Tabla | Condición |
|---|---|---|
| `branch_tax_rate_bp_check` | branch | `tax_rate_bp BETWEEN 0 AND 10000` |
| `branch_low_stock_threshold_check` | branch | `low_stock_threshold >= 0` |
| `branch_currency_check` | branch | `currency ~ '^[A-Z]{3}$'` |
| `branch_counter_value_check` | branch_counter | `value >= 0` |
| `app_user_username_lower_check` | app_user | `username = lower(username)` |
| `cash_session_amounts_check` | cash_session | `opening_amount >= 0 AND (expected_amount IS NULL OR expected_amount >= 0) AND (counted_amount IS NULL OR counted_amount >= 0)` |
| `cash_session_status_check` | cash_session | `OPEN` ⇒ `closed_by_id`, `closed_at`, `expected_amount`, `counted_amount` y `difference` son NULL. `CLOSED` ⇒ todos NOT NULL y `difference = counted_amount - expected_amount`. |
| `product_sku_check` | product | `sku ~ '^[A-Z0-9-]{3,40}$'` |
| `product_amounts_check` | product | `price >= 0 AND (cost IS NULL OR cost >= 0)` |
| `product_variant_sku_check` | product_variant | `sku ~ '^[A-Z0-9-]{3,40}$'` |
| `product_variant_price_override_check` | product_variant | `price_override IS NULL OR price_override >= 0` |
| `zone_code_check` | zone | `code ~ '^([A-Z]{1,2}\|STG)$'` |
| `zone_staging_code_check` | zone | `is_staging = (code = 'STG')` |
| `zone_color_check` | zone | `color IS NULL OR color ~ '^#[0-9A-F]{6}$'` |
| `container_code_check` | container | `code ~ '^(0[1-9]\|[1-9][0-9])$'` |
| `rack_code_check` | rack | `code ~ '^(0[1-9]\|[1-9][0-9])$'` |
| `rack_location_code_check` | rack | `location_code ~ '^([A-Z]{1,2}\|STG)-(0[1-9]\|[1-9][0-9])-(0[1-9]\|[1-9][0-9])$'` |
| `rack_capacity_check` | rack | `capacity_units >= 0` (staging usa 0 y su capacidad se ignora) |
| `rack_label_color_check` | rack | `label_color IS NULL OR label_color ~ '^#[0-9A-F]{6}$'` |
| `stock_location_qty_check` | stock_location | `quantity >= 0 AND reserved_qty >= 0 AND reserved_qty <= quantity` |
| `inventory_movement_qty_check` | inventory_movement | `quantity > 0` |
| `inventory_movement_shape_check` | inventory_movement | La forma de la tabla de §4.5 según `type`. En `RELOCATE`/`TO_STAGING`, además, `from_rack_id <> to_rack_id`. |
| `inventory_movement_reference_check` | inventory_movement | `(reference_type IS NULL) = (reference_id IS NULL)` |
| `inventory_movement_adjustment_reason_check` | inventory_movement | `(adjustment_reason IS NOT NULL) = (type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT'))` |
| `cart_discount_check` | cart | `discount >= 0` |
| `cart_number_check` | cart | `number BETWEEN 1 AND 999` |
| `cart_item_amounts_check` | cart_item | `quantity > 0 AND unit_price >= 0 AND discount >= 0 AND discount <= unit_price * quantity` |
| `sale_amounts_check` | sale | `subtotal >= 0 AND global_discount >= 0 AND discount_total >= global_discount AND tax_total >= 0 AND total >= 0 AND tax_rate_bp BETWEEN 0 AND 10000` |
| `sale_total_check` | sale | `total = subtotal - discount_total + CASE WHEN prices_include_tax THEN 0 ELSE tax_total END` |
| `sale_cancel_check` | sale | `(status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL AND cancel_reason IS NOT NULL)`, y si no está cancelada los tres son NULL |
| `sale_item_amounts_check` | sale_item | `quantity > 0 AND unit_price >= 0 AND discount >= 0 AND line_total = unit_price * quantity - discount AND line_total >= 0` |
| `payment_amount_check` | payment | `amount > 0` |
| `payment_cash_check` | payment | `(received IS NULL AND change IS NULL) OR (method = 'CASH' AND received >= amount AND change = received - amount)` |

La suma de `payment.amount` = `sale.total` se valida en el servicio de F8, no en la BD.

### 5.2 Índices únicos especiales

| Nombre | Definición |
|---|---|
| `cash_session_one_open_per_register` | `UNIQUE (cash_register_id) WHERE status = 'OPEN'` |
| `user_branch_one_default` | `UNIQUE (user_id) WHERE is_default` |
| `cart_one_active_per_user_branch` | `UNIQUE (branch_id, user_id) WHERE status = 'ACTIVE'` |
| `cart_number_open_per_branch` | `UNIQUE (branch_id, number) WHERE status IN ('ACTIVE', 'SUSPENDED')` |
| `zone_one_staging_per_warehouse` | `UNIQUE (warehouse_id) WHERE is_staging` |
| `category_parent_id_name_key` | Se recrea como `UNIQUE NULLS NOT DISTINCT (parent_id, name)` |
| `product_variant_product_id_size_color_material_key` | Se recrea como `UNIQUE NULLS NOT DISTINCT (product_id, size, color, material)` |

### 5.3 Kardex inmutable

Función `inventory_movement_immutable()` y trigger `inventory_movement_immutable_trg` `BEFORE UPDATE OR DELETE ON inventory_movement FOR EACH ROW`, que lanza `RAISE EXCEPTION 'inventory_movement es inmutable'`. `TRUNCATE` (usado en los tests) no se ve afectado.

### 5.4 Vista `v_rack_occupancy`

Una fila por rack:

| Columna | Valor |
|---|---|
| `rack_id`, `container_id`, `zone_id`, `warehouse_id` | Jerarquía |
| `location_code`, `is_active`, `capacity_units` | Del rack |
| `is_staging` | De la zona |
| `occupied_units` | `COALESCE(SUM(stock_location.quantity), 0)::int` |
| `reserved_units` | `COALESCE(SUM(stock_location.reserved_qty), 0)::int` |
| `free_units` | `capacity_units - occupied_units` (puede ser negativo si se excedió con permiso; en staging no tiene sentido) |

Prisma no modela la vista; F7 la consulta con `$queryRaw`.

---

## 6. Contratos en `packages/shared`

### 6.1 Archivos

```
packages/shared/src/
├── index.ts            # reexporta todo
├── health.ts           # (F0)
├── common.ts           # Uuid, IsoDateTime, Quantity, NonNegativeInt, BasisPoints
├── enums.ts            # los 10 enums de §4.1 como z.enum
├── permissions.ts      # PERMISSION_MODULES, PERMISSIONS, PermissionCode, SystemRoleCode, SYSTEM_ROLES
├── money.ts            # MoneyCents, SignedMoneyCents, formatMoney, parseMoney, applyBasisPoints
├── sku.ts              # SkuSchema, normalizeSku
├── locationCode.ts     # esquemas, buildLocationCode, parseLocationCode, toLocationQr
├── scanClassifier.ts   # classifyScan, PROMO_QR_PREFIX, isUrlLike, toPromoQrPayload
├── errors.ts           # ErrorCode, ApiErrorDto
├── pagination.ts       # PaginationQuery, sortQuery, paginated
└── dto/
    ├── index.ts
    ├── organization.ts # BranchDto, CashRegisterDto, CashSessionDto
    ├── security.ts     # UserDto, RoleDto, PermissionDto
    ├── catalog.ts      # CategoryDto, BrandDto, ProductDto, ProductVariantDto, ProductImageDto
    ├── warehouse.ts    # WarehouseDto, ZoneDto, ContainerDto, RackDto, StockLocationDto, InventoryMovementDto
    ├── pos.ts          # CartDto, CartItemDto, SaleDto, SaleItemDto, PaymentDto
    └── __fixtures__/dtoFixtures.ts   # un ejemplo válido por DTO (solo tests; excluido de cobertura)
```

Cada esquema exporta también su tipo (`export type X = z.infer<typeof X>`). Los tests van junto a cada archivo (`*.test.ts`).

### 6.2 `common.ts`

```ts
export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime();
export const NonNegativeInt = z.number().int().min(0).max(2_147_483_647);
export const Quantity = z.number().int().min(1).max(2_147_483_647);
export const BasisPoints = z.number().int().min(0).max(10_000);
```

### 6.3 `enums.ts`

Los 10 enums de §4.1, con el mismo nombre y los mismos valores, por ejemplo `export const PaymentMethod = z.enum(['CASH', 'CARD', 'TRANSFER'])`.

### 6.4 `permissions.ts`

`PERMISSION_MODULES = ['users', 'products', 'warehouse', 'inventory', 'pos', 'reports', 'settings']`.

`PERMISSIONS` (25; `{ code, module, description }` con la descripción en español):

| Código | Módulo | Descripción |
|---|---|---|
| `users.read` | users | Ver usuarios |
| `users.manage` | users | Crear, editar y desactivar usuarios |
| `users.permissions` | users | Asignar permisos a usuarios |
| `products.read` | products | Ver productos |
| `products.manage` | products | Crear, editar y desactivar productos |
| `products.import` | products | Carga masiva de productos |
| `products.labels` | products | Imprimir etiquetas de producto |
| `warehouse.read` | warehouse | Ver almacén y ocupación |
| `warehouse.manage` | warehouse | Configurar zonas, contenedores y racks |
| `warehouse.labels` | warehouse | Imprimir etiquetas de ubicación |
| `inventory.putaway` | inventory | Ubicar productos |
| `inventory.relocate` | inventory | Reubicar productos |
| `inventory.adjust` | inventory | Ajustar inventario |
| `inventory.override_capacity` | inventory | Exceder la capacidad de un rack |
| `inventory.movements.read` | inventory | Ver kardex |
| `inventory.other_branches.read` | inventory | Ver existencias en otras sucursales |
| `pos.session.open` | pos | Abrir caja |
| `pos.session.close` | pos | Cerrar caja (corte) |
| `pos.sell` | pos | Vender |
| `pos.discount` | pos | Aplicar descuentos |
| `pos.sale.cancel` | pos | Cancelar ventas |
| `reports.sales` | reports | Ver reporte de ventas propias |
| `reports.sales.all_users` | reports | Ver ventas de todos los usuarios |
| `settings.branch` | settings | Editar datos de la sucursal |
| `settings.registers` | settings | Editar cajas |

Formato de código: `^[a-z]+(\.[a-z_]+)+$`, y el primer segmento es su `module`.

`SystemRoleCode = z.enum(['OWNER', 'ADMIN', 'MANAGER', 'SELLER', 'WAREHOUSE_CLERK'])`. `SYSTEM_ROLES`:

| Código | Nombre | Permisos |
|---|---|---|
| `OWNER` | Propietario | Todos los del catálogo (25), derivados de `PERMISSIONS`, para que un permiso nuevo se incluya solo |
| `ADMIN` | Administrador | Los 25 |
| `MANAGER` | Gerente | Los 25 excepto `users.permissions` (24) |
| `SELLER` | Vendedor | `products.read`, `warehouse.read`, `pos.session.open`, `pos.session.close`, `pos.sell`, `inventory.relocate`, `inventory.other_branches.read` y `reports.sales` (8) |
| `WAREHOUSE_CLERK` | Almacenista | `products.read`, `products.labels`, `warehouse.read`, `warehouse.manage`, `warehouse.labels`, `inventory.putaway`, `inventory.relocate` e `inventory.movements.read` (8) |

### 6.5 `money.ts`

| Exportación | Contrato |
|---|---|
| `MoneyCents` | `z.number().int().min(0).max(2_147_483_647)` |
| `SignedMoneyCents` | `z.number().int().min(-2_147_483_648).max(2_147_483_647)` |
| `formatMoney(cents, currency = 'MXN', locale = 'es-MX'): string` | Usa `Intl.NumberFormat` con estilo moneda y 2 decimales. `123450` → `"$1,234.50"`. |
| `parseMoney(input: string): number \| null` | Acepta un `$` opcional, separador de miles `,` solo en grupos válidos y hasta 2 decimales. Devuelve centavos. Si la entrada es vacía, negativa o inválida, devuelve `null`. |
| `applyBasisPoints(amount, bp): number` | `amount × bp / 10000` redondeado a medio hacia arriba, con aritmética entera. Lanza `RangeError` si algún argumento no es un entero ≥ 0. |

### 6.6 `sku.ts`

- `normalizeSku(raw)`: `trim()` + `toUpperCase()`.
- `SkuSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, …)`. El mensaje, en español, dice: "El SKU debe tener de 3 a 40 caracteres: letras, números o guiones".

### 6.7 `locationCode.ts`

- Constantes: `STAGING_ZONE_CODE = 'STG'` y `LOCATION_QR_PREFIX = 'LOC:'`.
- `ZoneCodeSchema` (`^([A-Z]{1,2}|STG)$` tras trim + upper), `SegmentCodeSchema` (`^(0[1-9]|[1-9][0-9])$`) y `LocationCodeSchema` (forma canónica `A-01-03`).
- `buildLocationCode({ zone, container, rack }): string` lanza un `Error` si algún segmento es inválido.
- `parseLocationCode(raw): { zone, container, rack, code } | null` es tolerante con la captura manual: hace trim, pasa a mayúsculas y rellena con ceros los segmentos de 1 dígito (`"a-1-3"` → `A-01-03`). Rechaza el segmento `0`/`00`, más de 2 dígitos, más de 2 letras de zona (salvo `STG`) y un número de segmentos distinto de 3.
- `toLocationQr(code)` → `"LOC:A-01-03"`.

### 6.8 `scanClassifier.ts`

`classifyScan(raw: string): ScanResult`, donde:

```ts
type ScanResult =
  | { kind: 'location'; code: string }   // canónico, p. ej. "A-01-03"
  | { kind: 'product'; code: string }    // SKU o código de barras normalizado
  | { kind: 'promo'; text: string }      // QR de promoción del ticket (F5)
  | { kind: 'invalid'; raw: string };
```

Reglas, en este orden:
1. Quita espacios y caracteres de control (`\r`, `\n`, `\t`) al inicio y al final.
2. Si empieza con `LOC:` (sin distinguir mayúsculas), aplica `parseLocationCode` al resto: si es válido → `location`; si no → `invalid`.
3. Si empieza con `PROMO:` (sin distinguir mayúsculas) y el resto, recortado, no está vacío → `promo` con ese resto tal como se escribió; con el resto vacío → `invalid`.
4. Si `isUrlLike` → `promo` con la lectura completa.
5. Si no, aplica `normalizeSku`: si cumple `SkuSchema` → `product`; si no → `invalid`.

**QR de promoción** (decisión 2026-10-03, F5):
- `PROMO_QR_PREFIX = 'PROMO:'`.
- `isUrlLike(text)`: `^(https?://|www\.)`, sin distinguir mayúsculas.
- `toPromoQrPayload(text)`: un enlace (`isUrlLike`) se codifica tal cual, para que el celular del cliente lo abra; cualquier otro texto, como `PROMO:` + texto. Así, al escanearlo en el sistema, los dos casos se reconocen como `promo`.

### 6.9 `errors.ts`

```ts
export const ErrorCode = z.enum([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR',
  'AUTH_INVALID_CREDENTIALS', 'STOCK_INSUFFICIENT', 'RACK_CAPACITY_EXCEEDED',
]);
export const ApiErrorDto = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  details: z.unknown().optional(),
});
```

Cada spec posterior agrega sus códigos a `ErrorCode`.

### 6.10 `pagination.ts`

- `PaginationQuery`: `page` (coerce, entero ≥ 1, default 1), `pageSize` (coerce, entero 1–100, default 20) y `q` (trim, 1–100 caracteres, opcional; la cadena vacía se convierte en `undefined`).
- `sortQuery(fields)`: recibe una tupla no vacía de campos permitidos y devuelve un esquema opcional que acepta `"campo:asc|desc"` y lo transforma a `{ field, direction }`.
- `paginated(item)` → `z.object({ items: z.array(item), page, pageSize, total: NonNegativeInt })`.

### 6.11 DTOs (lectura)

Hay 22 DTOs, uno por modelo, salvo los que se excluyen abajo. Cada `XDto` es un `z.object` con **exactamente** los campos escalares del modelo, con este mapeo:

| Prisma | Zod |
|---|---|
| `id` y FKs | `Uuid` |
| `String` / `String?` | `z.string()` / `.nullable()` |
| `DateTime` | `IsoDateTime` (string ISO UTC) |
| `Boolean` | `z.boolean()` |
| enum | el enum de `enums.ts` |
| `String[]` | `z.array(z.string())` |
| `Int` de dinero | `MoneyCents`. Excepción: `CashSession.difference` usa `SignedMoneyCents`. |
| `Int` de cantidad en movimientos y partidas (`InventoryMovement.quantity`, `CartItem.quantity`, `SaleItem.quantity`) | `Quantity` |
| `Int` de tasa (`taxRateBp`) | `BasisPoints` |
| Otros `Int` (`lowStockThreshold`, `priority`, `sortOrder`, `capacityUnits`, `quantity`/`reservedQty` de stock, `value`) | `NonNegativeInt` |

Los campos opcionales (`?`) se devuelven como `null`, nunca se omiten.

**Exclusiones:**
- `UserDto` no incluye `passwordHash`.
- No tienen DTO: `RefreshToken`, `BranchCounter`, `RolePermission`, `UserPermission`, `UserBranch` y `AuditLog`. Las vistas compuestas que los necesiten se definen en su fase.

---

## 7. Seeds

### 7.1 Archivos

```
apps/api/prisma/
├── schema.prisma
├── migrations/<ts>_init/  <ts>_constraints/
├── seed.ts              # entrada del seed base: parseSeedEnv → createPrismaClient → seedBase
├── seed-demo.ts         # entrada del seed de demo
└── seed/
    ├── env.ts           # parseSeedEnv(env) con Zod
    ├── base.ts          # seedBase(prisma, { adminPassword }): Promise<SeedSummary>
    └── demo.ts          # seedDemo(prisma): Promise<SeedSummary>
```

`parseSeedEnv` exige `DATABASE_URL`, `OWNER_INITIAL_PASSWORD` y `ADMIN_INITIAL_PASSWORD` (ambas ≥ 8 caracteres). Si alguna falla, lanza un error en español que nombra la variable, y la entrada termina con código 1. `seed-demo.ts` solo exige `DATABASE_URL`.

### 7.2 Seed base (idempotente, en una sola transacción)

| Dato | Clave natural | Si no existe | Si ya existe |
|---|---|---|---|
| Permisos (§6.4) | `code` | Se crea. | Se actualizan `module` y `description`. Los permisos que ya no están en el catálogo se **borran** (cascade a `RolePermission`/`UserPermission`). |
| Roles del sistema (§6.4) | `code` | Se crea con `isSystem = true`. | Se actualiza `name` y se sincronizan sus permisos para que coincidan **exactamente** con `SYSTEM_ROLES`. |
| Sucursal | `code = 'S1'` | `name "Sucursal 1"` con los defaults de §4.2 (MXN, 1600, IVA incluido, umbral 2, `America/Mexico_City`). | No se toca. |
| Contador | (`S1`, `SALE_FOLIO`) | `value = 0` | No se toca. |
| Cajas | (`S1`, `C1`) y (`S1`, `C2`) | `"Caja 1"` y `"Caja 2"` | No se tocan. |
| Almacén | (`S1`, `ALM1`) | `"Almacén principal"` | No se toca. |
| Zona de staging | (`ALM1`, `STG`) | `name "Staging"`, `isStaging true` | No se toca. |
| Contenedor de staging | (`STG`, `01`) | `name "Staging"` | No se toca. |
| Rack de staging | (contenedor, `01`) | `locationCode "STG-01-01"`, `capacityUnits 0` | No se toca. |
| Usuario `owner` | `username` | `fullName "Propietario"`, rol `OWNER`, hash argon2id de `OWNER_INITIAL_PASSWORD`, `mustChangePassword true` y `UserBranch(S1, isDefault true)`. | No se toca; **nunca** se restablece su contraseña (para eso existe el comando de F4). |
| Usuario `admin` | `username` | `fullName "Administrador"`, rol `ADMIN`, hash argon2id de `ADMIN_INITIAL_PASSWORD`, `mustChangePassword true` y `UserBranch(S1, isDefault true)`. | No se toca; **nunca** se restablece su contraseña. |
| Categorías raíz | (`null`, `name`) | `Calzado`, `Bolsos` y `Accesorios` | No se tocan. |
| Segunda sucursal | `code = 'S2'` | `name "Sucursal 2"` con los mismos defaults que `S1`. | No se toca. |
| Contador, cajas, almacén y staging de `S2` | Las mismas claves que en `S1`, con `S2` | `SALE_FOLIO` en 0; `C1` "Caja 1" y `C2` "Caja 2"; `ALM1` "Almacén principal"; zona `STG`, contenedor `01` y rack `STG-01-01`. | No se tocan. |

Al terminar, imprime un resumen en español con lo creado, lo actualizado y lo borrado.

### 7.3 Seed de demo (idempotente, sin stock)

Requiere que exista el seed base (`S1`/`ALM1`). Si no existe, termina con código 1 y el mensaje "Ejecuta primero `pnpm db:seed`", sin escribir nada.

| Dato | Contenido |
|---|---|
| Zonas | `A` "Zona A" (`#2563EB`), `B` "Zona B" (`#16A34A`) y `C` "Zona C" (`#DC2626`), con `sortOrder` 1–3 |
| Contenedores | `01` y `02` en cada zona (6) |
| Racks | `01`–`04` en cada contenedor, con capacidad 40 (24 racks, de `A-01-01` a `C-02-04`) |
| Marcas | `Demo Calzado` y `Demo Bolsos` |
| `ZAP0101` | "Zapato de piel dama", `VARIABLE`, Calzado, Demo Calzado, precio 89 900 y costo 45 000. Variantes: tallas 23–26 × colores Negro/Café (8), SKU `ZAP0101-{talla}-{NEG\|CAF}`. |
| `ZAP0102` | "Tenis urbano", `VARIABLE`, Calzado, Demo Calzado, precio 129 900. Variantes: tallas 25–27 en Blanco (3), SKU `ZAP0102-{talla}-BLA`. |
| `BOL0201` | "Bolso tote", `VARIABLE`, Bolsos, Demo Bolsos, precio 74 900. Variantes: Negro/Rojo sin talla (2), SKU `BOL0201-{NEG\|ROJ}`. |
| `ACC0301` | "Cinturón de piel", `SIMPLE`, Accesorios, precio 34 900. Una variante por defecto con `sku = ACC0301` y atributos nulos. |

En total son 4 productos y 14 variantes. No crea imágenes, `StockLocation` ni `InventoryMovement`. Si un registro ya existe (por su clave natural), no lo modifica.

---

## 8. Infraestructura y scripts

**`infra/docker-compose.dev.yml`:** se agrega el servicio `postgres-test`:
- imagen `postgres:16-alpine`;
- usuario y contraseña tomados de `POSTGRES_USER`/`POSTGRES_PASSWORD`, y `POSTGRES_DB=warehouse_test`;
- puerto `5433:5432`;
- `tmpfs: /var/lib/postgresql/data`;
- healthcheck con `pg_isready`.

`pnpm dev:db` levanta ambos servicios.

**`.env.example`:** se agregan, con su comentario en español:

```
# Pruebas de integración (servicio postgres-test)
TEST_DATABASE_URL=postgresql://warehouse:warehouse@localhost:5433/warehouse_test
# Seed: contraseñas iniciales del Propietario (owner) y del admin (mín. 8 caracteres; se pide cambiarlas al entrar)
OWNER_INITIAL_PASSWORD=cambia-esta-clave-owner
ADMIN_INITIAL_PASSWORD=cambia-esta-clave
```

**Scripts de `apps/api`:**

| Script | Acción |
|---|---|
| `postinstall` | `prisma generate` |
| `db:generate` | `prisma generate` |
| `db:migrate` | `prisma migrate dev` |
| `db:deploy` | `prisma migrate deploy` |
| `db:seed` | `tsx prisma/seed.ts` |
| `db:seed:demo` | `tsx prisma/seed-demo.ts` |
| `test` | `jest --runInBand` (projects `unit` + `integration`) |
| `test:unit` / `test:int` | Cada *project* por separado |

**Scripts de la raíz:** `db:migrate`, `db:seed` y `seed:demo` delegan en `@warehouse-manager/api`.

**Otros archivos:**
- `.gitignore`, `.prettierignore` y `eslint.config.js` ignoran `apps/api/src/generated/`.
- El `tsconfig` de `api` incluye en el typecheck `prisma/**`, `test/**` y `prisma.config.ts`, pero el build solo emite `src`.

---

## 9. Reglas y casos borde

1. **Seed sin variables:** falla antes de conectarse, nombra la variable faltante y no escribe nada.
2. **Seed parcial:** el seed base corre en una transacción; si algo falla, no queda nada a medias.
3. **Permiso retirado del catálogo:** el seed lo borra junto con sus asignaciones. Un permiso nuevo en el catálogo se crea y se asigna a los roles del sistema que lo incluyan.
4. **Ediciones del usuario:** el seed no sobrescribe datos editables (sucursal, cajas, almacén, `owner`, `admin`, categorías). Solo sincroniza permisos y roles del sistema, que no son editables en el MVP (F4 solo los lista).
5. **BD de pruebas equivocada:** el `globalSetup` aborta si `TEST_DATABASE_URL` no termina en `_test` o si coincide con `DATABASE_URL`.
6. **Escaneo con basura de lector HID** (`"\r\n"` al final, tab): `classifyScan` la limpia.
7. **Captura manual de ubicación** `"a-1-3"`: se normaliza a `A-01-03`. `"A-00-01"`, `"A-100-01"` y `"ABC-01-01"` son inválidos.
8. **Variante sin atributos repetida** dentro del mismo producto: la rechaza `NULLS NOT DISTINCT`.
9. **Montos negativos o incoherentes** (total que no cuadra, cambio mal calculado, venta cancelada sin motivo): los rechazan los `CHECK` de la BD, aunque un servicio futuro tenga un bug.
10. **Kardex:** cualquier `UPDATE` o `DELETE` falla; las correcciones se hacen con movimientos nuevos.

---

## 10. Riesgos de la fase (si ocurren: `BLOQUEADA` y pregunta, P3)

| ID | Riesgo | Señal | Opciones que se presentarían |
|---|---|---|---|
| R1 | El cliente generado por Prisma (ESM, posible `import.meta`) no carga en Jest con `ts-jest` en CJS (decisión de F0). | Falla el TODO 1. | Ajustar `moduleFormat` del generador, mover Jest de `api` a ESM o mapear el cliente en Jest. |
| R2 | Prisma no representa los índices parciales o `NULLS NOT DISTINCT`, y `migrate diff` propone borrarlos. | Falla T16. | Declararlos en el schema si la versión lo soporta, o documentar la excepción de drift. |
| R3 | Las flags de `prisma migrate diff` o la configuración del seed cambiaron en la versión instalada. | Falla T16 o `db:seed`. | Ajustar al CLI vigente sin cambiar la intención del test. |
| R4 | pnpm bloquea los scripts de instalación de `argon2` o `prisma`. | Falla `pnpm install`/`generate`. | `onlyBuiltDependencies` (ya previsto en §3). |

---

## 11. TODOs (en orden, verificables)

- [ ] **1. Toolchain Prisma (R1, R4).**
  - Instalar las dependencias de §3, crear `prisma.config.ts`, un `schema.prisma` con solo `generator` + `datasource`, y `src/core/prisma-client.ts`. Agregar los scripts `postinstall`/`db:generate` y los ignores del cliente generado.
  - *Verificable:* `pnpm install` regenera el cliente; `pnpm typecheck` OK; un import de `createPrismaClient` funciona con `tsx` y dentro de un test de Jest (el test provisional se elimina en el TODO 9, cuando T14 ya cubre el import).
- [ ] **2. BD de pruebas e infraestructura de tests.**
  - Agregar `postgres-test` al compose y las variables de §8 a `.env.example`. Configurar los projects de Jest, el `globalSetup` con guardas y `test/integration/helpers/db.ts` (`truncateAll`, cliente de test).
  - *Verificable:* `pnpm dev:db` deja ambos servicios `healthy`; el `globalSetup` aborta con una URL que no termina en `_test`.
- [ ] **3. `shared`: common, enums y permisos.**
  - Crear `common.ts`, `enums.ts`, `permissions.ts` y el test **T10**.
  - *Verificable:* T10 en verde.
- [ ] **4. `shared`: dinero y SKU.**
  - Crear `money.ts`, `sku.ts` y los tests **T1–T4**.
  - *Verificable:* T1–T4 en verde.
- [ ] **5. `shared`: ubicación y escaneo.**
  - Crear `locationCode.ts`, `scanClassifier.ts` y los tests **T5–T7** y **T26**.
  - *Verificable:* T5–T7 y T26 en verde.
- [ ] **6. `shared`: errores y paginación.**
  - Crear `errors.ts`, `pagination.ts` y los tests **T8–T9**.
  - *Verificable:* T8–T9 en verde.
- [ ] **7. Schema completo y migración `init`.**
  - Escribir `schema.prisma` según §4 y ejecutar `pnpm db:migrate --name init` sobre la BD de desarrollo.
  - *Verificable:* la migración se genera y se aplica sin errores.
- [ ] **8. Migración `constraints`.**
  - Crear la migración con `--create-only` y escribir el SQL de §5. Agregar los tests **T16–T20**.
  - *Verificable:* T16–T20 en verde.
- [ ] **9. DTOs y paridad.**
  - Crear `dto/*`, las fixtures y el test **T11**. Crear `test/parity/prismaSchema.ts` y los tests **T14–T15**.
  - *Verificable:* T11, T14 y T15 en verde.
- [ ] **10. Contraseñas.**
  - Crear `src/core/password.ts` y el test **T12**.
  - *Verificable:* T12 en verde.
- [ ] **11. Seed base.**
  - Crear `prisma/seed/env.ts`, `prisma/seed/base.ts` y `prisma/seed.ts`, junto con los tests **T13** y **T21–T23**.
  - *Verificable:* T13 y T21–T23 en verde, y `pnpm db:seed` corre dos veces sobre la BD de desarrollo sin duplicar.
- [ ] **12. Seed de demo.**
  - Crear `prisma/seed/demo.ts` y `prisma/seed-demo.ts`, junto con los tests **T24–T25**.
  - *Verificable:* T24–T25 en verde.
- [ ] **13. Scripts raíz y README.**
  - Agregar `db:migrate`, `db:seed` y `seed:demo` a la raíz. En el README: migrar, sembrar, cambiar `OWNER_INITIAL_PASSWORD` y `ADMIN_INITIAL_PASSWORD`, aclarar que `pnpm test` requiere `pnpm dev:db` y explicar cómo resetear la BD de desarrollo.
  - *Verificable:* el usuario sigue el README desde una BD vacía.
- [ ] **14. ERD.**
  - Crear `docs/erd.md` con los diagramas mermaid de organización/seguridad, catálogo/almacén y POS, con todos los campos de §4.
  - *Verificable:* revisión modelo por modelo contra `schema.prisma` (checklist en §14).
- [ ] **15. Cierre.**
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; registrar la cobertura; llenar §14 Evidencia y actualizar `tests_requeridos_en_verde`.
  - Aplicar la Definition of Done (constitución §4).

---

## 12. Tests requeridos (lista cerrada: 26)

| ID | Paquete / archivo | Caso |
|---|---|---|
| T1 | `shared` · `money.test.ts` | `formatMoney` (`it.each`): `123450` → `"$1,234.50"`, `0` → `"$0.00"`, `5` → `"$0.05"`. |
| T2 | `shared` · `money.test.ts` | `parseMoney` válidos: `"1234.5"` → 123450, `"$1,234.50"` → 123450, `"1,234"` → 123400, `"0.05"` → 5. Inválidos → `null`: `""`, `"abc"`, `"-5"`, `"1.234"`, `"1,23"`. |
| T3 | `shared` · `money.test.ts` | `MoneyCents` acepta 0 y 2147483647, y rechaza 1.5, -1 y 2147483648. `applyBasisPoints`: (10000, 1600) → 1600, (333, 1600) → 53, (3, 5000) → 2, (3125, 1600) → 500. Lanza `RangeError` con 1.5 o -1. |
| T4 | `shared` · `sku.test.ts` | `normalizeSku(" zap01 ")` → `"ZAP01"`. `SkuSchema` acepta `ZAP0101-25-NEG` y uno de 40 caracteres; rechaza 2 caracteres, 41 caracteres, `"ZAP 01"` y `"ZAP_01"` (`it.each`). |
| T5 | `shared` · `locationCode.test.ts` | `buildLocationCode` → `A-01-03`, `AB-12-99` y `STG-01-01`; lanza error con zona `ABC`, contenedor `00` o rack `100`. |
| T6 | `shared` · `locationCode.test.ts` | `parseLocationCode`: canónicos, tolerantes (`"a-1-3"` → `A-01-03`, `" stg-1-1 "` → `STG-01-01`) e inválidos → `null` (`"A-00-01"`, `"A-100-01"`, `"ABC-01-01"`, `"A01-03"`, `""`). `toLocationQr("A-01-03")` → `"LOC:A-01-03"`. |
| T7 | `shared` · `scanClassifier.test.ts` | `it.each`: `"LOC:A-01-03"` → location; `"loc:a-1-3\r\n"` → location `A-01-03`; `" zap0101-25-neg\t"` → product `ZAP0101-25-NEG`; `"7501234567890"` → product; `"LOC:XYZ"` → invalid; `""` → invalid; `"ZAP 01"` → invalid; `"PROMO:DESC10"` → promo `DESC10`; `"promo:desc10\r\n"` → promo `desc10`; `"PROMO:"` → invalid; `"https://ejemplo.com/x"` y `"WWW.EJEMPLO.COM"` → promo con la lectura completa. |
| T8 | `shared` · `pagination.test.ts` | Defaults (page 1, pageSize 20); coerción desde strings; rechazo de page 0, pageSize 0 y pageSize 101; `q: ""` → `undefined`; `sortQuery(['name','sku'])` acepta `"name:asc"` y rechaza `"price:asc"` y `"name:up"`; `paginated(X)` valida `items` y `total`. |
| T9 | `shared` · `errors.test.ts` | `ApiErrorDto` acepta `{code:'NOT_FOUND', message:'…'}` (con y sin `details`); rechaza un código desconocido y un mensaje vacío. |
| T10 | `shared` · `permissions.test.ts` | 25 códigos únicos con el formato de §6.4, cuyo primer segmento es su `module` y está en `PERMISSION_MODULES`. Los conjuntos de `SYSTEM_ROLES` son exactamente los de §6.4 (25/25/24/8/8) y solo contienen códigos del catálogo; `OWNER` es igual a todo `PERMISSIONS`. |
| T11 | `shared` · `dto/dto.test.ts` | `it.each` sobre los 22 DTOs: la fixture válida pasa; se rechaza con `id` no UUID, con fecha no ISO y, en los DTOs con dinero, con un monto decimal. Cada campo nullable acepta `null`. |
| T12 | `api` · `src/core/password.test.ts` | `hashPassword` produce `$argon2id$…`; `verifyPassword` da `true` con la contraseña correcta y `false` con otra; dos hashes de la misma contraseña son distintos. |
| T13 | `api` · `test/unit/seed-env.test.ts` | `parseSeedEnv` acepta un env válido y lanza error que nombra la variable si falta `DATABASE_URL`, si falta `OWNER_INITIAL_PASSWORD` o `ADMIN_INITIAL_PASSWORD`, o si alguna tiene menos de 8 caracteres (`it.each`). |
| T14 | `api` · `test/parity/enums.test.ts` | Cada uno de los 10 enums de `shared` coincide (mismo conjunto de valores) con el enum homónimo de `schema.prisma`, y no hay enums de Prisma sin contraparte. |
| T15 | `api` · `test/parity/dtos.test.ts` | Para cada uno de los 22 DTOs: sus claves son exactamente los campos escalares del modelo menos las exclusiones de §6.11, y un campo es `nullable` si y solo si es opcional en Prisma. Los modelos sin DTO son exactamente los 6 declarados. |
| T16 | `api` · `test/integration/migrations.int.test.ts` | Tras el `globalSetup`, las 2 migraciones están aplicadas (`finished_at` no nulo) y `prisma migrate diff` (BD contra schema, `--exit-code`) no reporta diferencias. |
| T17 | `api` · `test/integration/constraints.int.test.ts` | `it.each` sobre cada `CHECK` de §5.1: el caso inválido falla con un error que menciona el nombre de la restricción, y el caso base válido de cada tabla se inserta. |
| T18 | `api` · `test/integration/unique-indexes.int.test.ts` | §5.2: la segunda sesión `OPEN` de una caja falla, pero `OPEN` en otra caja y `OPEN` + `CLOSED` en la misma pasan; el segundo `isDefault` de un usuario falla; un segundo carrito `ACTIVE` del mismo usuario en la misma sucursal falla, pero uno `SUSPENDED`, el de otro usuario o el de otra sucursal pasan; el mismo `number` en dos carritos abiertos de la sucursal falla, pero pasa si uno está `CHECKED_OUT` o `DISCARDED`; la segunda zona de staging falla; una categoría raíz duplicada falla; una variante con atributos nulos duplicada falla; el mismo `locationCode` falla en el mismo almacén y pasa en otro. |
| T19 | `api` · `test/integration/kardex.int.test.ts` | `INSERT` en `inventory_movement` funciona; `UPDATE` y `DELETE` fallan con "inventory_movement es inmutable". |
| T20 | `api` · `test/integration/rack-occupancy.int.test.ts` | Un rack con dos `stock_location` (5/1 y 3/0) da `occupied_units` 8, `reserved_units` 1 y `free_units` = capacidad − 8; un rack sin stock da 0/0/capacidad. |
| T21 | `api` · `test/integration/seed-base.int.test.ts` | Sobre una BD vacía: 25 permisos; 5 roles del sistema con 25/25/24/8/8 permisos; `owner` con rol `OWNER`, `mustChangePassword` y un hash que verifica con `OWNER_INITIAL_PASSWORD`; sucursales `S1` y `S2` con los defaults de §7.2; en cada una, contador en 0, cajas `C1`/`C2`, `ALM1` y zona `STG` (`isStaging`) con contenedor `01` y rack `STG-01-01` (en total 2 sucursales, 4 cajas, 2 almacenes y 2 racks de staging); `admin` con rol `ADMIN`, `mustChangePassword` y un hash que verifica con la contraseña dada; `UserBranch` por defecto en `S1` para `owner` y `admin`; 3 categorías raíz. |
| T22 | `api` · `test/integration/seed-base.int.test.ts` | Correr el seed 2 veces deja los mismos conteos y los mismos ids. Tras editar el nombre de `S1`, el de `S2` y el de `C1` de `S1`, y tras cambiar los hashes de `owner` y `admin`, la segunda corrida conserva los cinco cambios. |
| T23 | `api` · `test/integration/seed-base.int.test.ts` | Tras quitar un permiso de `SELLER`, agregarle uno extra e insertar un permiso ajeno al catálogo (asignado a un usuario), la corrida restaura los conjuntos exactos de los roles y borra el permiso ajeno junto con sus asignaciones. |
| T24 | `api` · `test/integration/seed-demo.int.test.ts` | Tras el seed base, el seed de demo crea 3 zonas, 6 contenedores y 24 racks (de `A-01-01` a `C-02-04`, con capacidad 40), 2 marcas, 4 productos y 14 variantes (`ACC0301` con su variante por defecto), y deja 0 `stock_location` y 0 `inventory_movement`. Una segunda corrida no duplica nada. |
| T25 | `api` · `test/integration/seed-demo.int.test.ts` | Sin seed base, el seed de demo lanza el error "Ejecuta primero `pnpm db:seed`" y no escribe ninguna fila. |
| T26 | `shared` · `scanClassifier.test.ts` | `toPromoQrPayload` (`it.each`): `"DESC10"` → `"PROMO:DESC10"`; `"https://ejemplo.com"`, `"http://x.mx"` y `"www.ejemplo.com"` se devuelven sin cambio. `classifyScan(toPromoQrPayload(t))` da `promo` con `text` igual a `t` para `"DESC10"` y para `"www.ejemplo.com"`. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4).

---

## 13. Criterios de aceptación

| # | Criterio | Evidencia esperada |
|---|---|---|
| CA1 | `prisma migrate dev` y `pnpm db:seed` funcionan sobre una BD de desarrollo vacía, y el seed se puede ejecutar dos veces sin duplicar datos. | T16, T21, T22 + salida de los comandos en §14 |
| CA2 | Pasan los tests de `shared`: dinero, normalización de SKU, construcción y parseo de `locationCode`, clasificador de escaneo (incluida la promoción), paginación, errores, permisos y DTOs. | T1–T11, T26 |
| CA3 | Las garantías de BD (`CHECK`, índices especiales, kardex inmutable y vista) son efectivas. | T17–T20 |
| CA4 | `shared` y Prisma no divergen en enums ni en campos de DTO. | T14, T15 |
| CA5 | El seed de demo crea estructura y catálogo sin escribir stock. | T24, T25 |
| CA6 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio. | Salida de los comandos en §14 |
| CA7 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §14 |
| CA8 | `docs/erd.md` coincide con `schema.prisma`. | Checklist modelo por modelo en §14 (verificación manual acordada) |

---

## 14. Evidencia

*(Se completa al cerrar la fase: salidas de comandos, cobertura y checklist del ERD, con fecha y responsable.)*

---

## 15. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-01 | F1 define solo los `Dto` de lectura; `Create`/`Update`/`ListQuery` van en la spec de cada módulo. | Usuario (chat); plan §8 F1 actualizado |
| 2026-10-01 | Postgres de pruebas (`postgres-test`) y tests de integración de BD desde F1. | Usuario (chat); plan §8 F1 y §9 actualizados |
| 2026-10-01 | Umbral de stock bajo en `Branch.lowStockThreshold` (default 2). | Usuario (chat), §13.9 |
| 2026-10-01 | MXN, IVA 16 % incluido; pagos CASH/CARD/TRANSFER con mixto y referencia; descuentos por partida y global en centavos. | Usuario (chat), §13.1, §13.3 y §13.4 |
| 2026-10-01 | Exceder la capacidad se permite con `inventory.override_capacity`, y queda `capacityOverridden` en el movimiento. | Usuario (chat), §13.10 |
| 2026-10-01 | Código de ubicación `A-01-03` aprobado; el rack de staging es `STG-01-01`. | Usuario (chat), §13.11; plan §4.3 corregido (`STG-01` → `STG-01-01`) |
| 2026-10-01 | Cancelación total en el MVP con caja abierta: stock a staging (`SALE_CANCEL`), permiso `pos.sale.cancel` solo para Administrador y Gerente. Campos `cancelledAt`/`cancelledById`/`cancelReason`. | Usuario (chat), §13.5; plan §1.2, §4, §6.2, F8 y §11 actualizados |
| 2026-10-01 | Solo `customerName` opcional; sin CFDI ni campos fiscales del comprador; imágenes opcionales por variante. | Usuario (chat), §13.2, §13.7 y §13.12 |
| 2026-10-01 | §13.6 (hardware), §13.8 (volumen) y §13.13 (despliegue) siguen pendientes, y el usuario los declara **no bloqueantes** para F1. | Usuario (chat) |
| 2026-10-01 | Seed de demo sin stock; el stock de demo llega en F7 vía `InventoryService`. | Usuario (chat); plan §8 F1 y F7 actualizados |
| 2026-10-01 | ERD en mermaid a mano (`docs/erd.md`). | Usuario (chat) |
| 2026-10-01 | `Sale` guarda una copia de `taxRateBp` y `pricesIncludeTax`, y `globalDiscount` aparte de `discountTotal`; `Cart.discount` para el descuento global. | Propuesta del agente (derivada de §13.1 y §13.4); revisar al aprobar |
| 2026-10-01 | `UserType` solo tiene `STAFF` (constitución P2: nada del roadmap). | Propuesta del agente; plan §4.2 actualizado |
| 2026-10-01 | `User` → tabla `app_user`; sin `created_by_id`; `Rack.warehouseId` desnormalizado; `CHECK` de forma del kardex y trigger de inmutabilidad. | Propuesta del agente; revisar al aprobar |
| 2026-10-02 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
| 2026-10-03 | Nuevo rol del sistema `OWNER` ("Propietario"), único, con todos los permisos del catálogo. El seed crea el usuario aparte `owner` con `OWNER_INITIAL_PASSWORD`; `admin` sigue como Administrador. Cambian §6.4, §7, §8 y los tests T10, T13, T21 y T22. | Usuario (chat), durante la redacción de F4; plan §6.2, §8 F1 y §10.1 actualizados |
| 2026-10-03 | QR de promoción: se quita `Branch.promoQrImageUrl` y se agrega `promoQrCaption`. El QR se genera desde `promoQrText` y la descripción se imprime debajo. | Usuario (chat), durante la redacción de F5; plan §4.2 actualizado |
| 2026-10-03 | `classifyScan` reconoce el QR de promoción (`kind: 'promo'`): prefijo `PROMO:` o un enlace. `toPromoQrPayload` decide el contenido del QR. Nuevo test T26 (total 26). | Usuario (chat), durante la redacción de F5; plan §5.3 y §7.1 actualizados |
| 2026-10-03 | El seed crea una segunda sucursal `S2` ("Sucursal 2") con sus cajas `C1`/`C2`, almacén y staging. Permiso nuevo `inventory.other_branches.read` (25 en el catálogo; también para el Vendedor). Cambian §6.4, §7.2 y los tests T10, T21 y T22. | Usuario (chat), durante la revisión de F6; plan §1.2, §4.2, §6.2, §8 F1, F7, F8 y §11 actualizados |
| 2026-10-03 | Enum nuevo `AdjustmentReason` (Conteo físico, Merma o daño, Extravío, Hallazgo, Error de captura, Otro) y campo `InventoryMovement.adjustmentReason`, obligatorio solo en los ajustes (`CHECK inventory_movement_adjustment_reason_check`). Pasan a ser 10 enums (T14); T17 cubre el `CHECK` nuevo. | Usuario (chat), durante la redacción de F7; plan §8 F7 actualizado |
| 2026-10-05 | `Sale.cashierId` (FK `User` "SaleCashier", quien cobró; `sellerId` es quien armó el carrito) e índice único parcial de un carrito `ACTIVE` por usuario. Cambian §4.6, §5.2, T15 (por el campo nuevo de `SaleDto`) y T18. | Usuario (chat), durante la redacción de F8; plan §4.1 y §4.2 actualizados |
| 2026-10-05 | `Cart.cashSessionId` se reemplaza por `Cart.branchId`: el vendedor arma el carrito sin elegir caja ("Atender") y la venta se registra en la caja que cobra. El índice parcial queda `cart_one_active_per_user_branch` (`UNIQUE (branch_id, user_id) WHERE status = 'ACTIVE'`). Cambian §4.6, §5.2, T15 (`CartDto`) y T18. | Usuario (chat), durante la revisión de F8; plan §4.1, §4.2 y §4.3 actualizados |
| 2026-10-05 | `Cart.number` (número corto 1–999, `CHECK cart_number_check`) e índice parcial `cart_number_open_per_branch`: único entre los carritos `ACTIVE`/`SUSPENDED` de la sucursal y reutilizable cuando el carrito se cobra o se descarta. Cambian §4.6, §5.1, §5.2, T15 (`CartDto`), T17 y T18. | Usuario (chat), durante la revisión de F8; plan §4.2 actualizado |
