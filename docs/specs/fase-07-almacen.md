---
id: fase-07
titulo: Almacén e inventario
estado: BORRADOR
depende_de: [fase-06]
autoriza_codigo_en:
  - "apps/api/src/modules/warehouse/**"
  - "apps/api/src/modules/inventory/inventory.routes.ts"
  - "apps/api/src/modules/inventory/inventory.queries.ts"
  - "apps/api/src/modules/inventory/*.test.ts"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/core/errors.test.ts"
  - "apps/api/src/app.ts"
  - "apps/api/prisma/seed/demo.ts"
  - "apps/api/test/integration/warehouse-*.int.test.ts"
  - "apps/api/test/integration/inventory-api-*.int.test.ts"
  - "apps/api/test/integration/seed-demo.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/warehouse.ts"
  - "packages/shared/src/warehouse.test.ts"
  - "packages/shared/src/inventory.ts"
  - "packages/shared/src/inventory.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "apps/web/src/features/warehouse/**"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Transferencias entre sucursales o almacenes (post-MVP); la consulta de otras sucursales es solo lectura"
  - "Sugerencia de ubicaciones por rotación (ABC) y niveles de rack (bins) (post-MVP)"
  - "Sesiones de conteo físico guiado; el conteo se registra como ajuste con motivo \"Conteo físico\""
  - "Reportes por motivo de ajuste y exportar el kardex (los datos quedan guardados para después)"
  - "Pantalla para varios almacenes por sucursal: la UI usa el almacén activo de la sucursal (la API ya recibe :id)"
  - "Reservas y venta desde el POS (F8)"
  - "Cambios en InventoryService (F2) salvo el motivo de ajuste ya declarado en F2; modo offline; impresión directa ESC/POS"
  - "Cambios a schema.prisma o migraciones (el modelo es de F1; si hiciera falta, se pregunta)"
tests_requeridos_total: 38
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/warehouse/**, apps/api/src/modules/inventory/** (rutas y consultas nuevas), apps/web/src/features/warehouse/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 7: Almacén e inventario

## 1. Contexto y alcance

Referencias: plan §1.2 (Almacén), §4.2–4.3 (almacén, capacidad, estados, staging, concurrencia), §5 (códigos de ubicación y QR), §6.2 (permisos), §7 (escaneo e impresión), §8 Fase 7, §9 (pruebas) y §12 (rendimiento del mapa). Se apoya en F1 (modelo, `v_rack_occupancy`, `parseLocationCode`, `toLocationQr`, `classifyScan`, `AdjustmentReason`, seed), F2 (`InventoryService`, `branchContext`, `AuditService`, paginación), F3 (`ScanInput`, `CapacityBar`, `DataTable`, `PrintLayout`, `QrCode`, formato de fechas), F5 (`Branch.lowStockThreshold`, `Branch.phone`, `Branch.timezone`) y F6 (lookup de productos).

**Objetivo:** la estructura física del almacén, ubicar y mover productos, ver la capacidad y el mapa, y saber dónde está cada cosa. Al terminar F7:

- se configuran zonas, contenedores y racks (también en lote), con colores, capacidad y códigos editables;
- el mapa muestra la ocupación en cada nivel y el contenido de cada rack, con filtros por estado;
- "Buscar producto" muestra dónde está una variante y, con permiso, cuánto hay en otras sucursales;
- se ubica (desde staging o mercancía nueva), se reubica y se ajusta, todo con su movimiento en el kardex;
- se consulta el kardex y se imprimen etiquetas QR de ubicación en 3 formatos;
- el seed de demo carga stock de ejemplo.

**Alcance (entra):**

1. Contratos de estructura e inventario en `shared`, con `occupancyLevel` (pendiente desde F1) y `variantStockStatus`.
2. Endpoints de estructura, árbol, contenido, búsqueda, sugerencias, ubicar, reubicar, ajustar, kardex y etiquetas.
3. Stock en el seed de demo (en `S1` y en el staging de `S2`).
4. UI de almacén: inicio, mapa, buscar, ubicar (dos modos), reubicar, staging, ajuste, kardex, configurar y etiquetas.

**Fuera de alcance:** ver la cabecera. **Regresión declarada de F1:** el seed de demo ahora crea stock, así que T24 de F1 se adapta ("deja 0 `stock_location`" pasa a verificar el stock de §7.2 de esta spec). Es el único cambio permitido sobre entregables de F1.

---

## 2. Modelo de datos afectado

Sin cambios de schema (el motivo de ajuste ya se agregó en F1). Usa `Warehouse`, `Zone`, `Container`, `Rack`, `StockLocation`, `InventoryMovement` (con `adjustmentReason`), la vista `v_rack_occupancy`, y de `Branch` lee `lowStockThreshold`, `phone`, `timezone` e `isActive`. Todo cambio de stock pasa por `InventoryService` (F2).

| Concepto | Regla en F7 |
|---|---|
| Almacén de trabajo | El almacén activo de la sucursal actual (el MVP tiene uno por sucursal). |
| Staging | La zona `STG`, su contenedor `01` y su rack `STG-01-01` son **fijos**: no se editan, desactivan ni borran, y no se les agregan contenedores ni racks. No tienen límite de capacidad y no cuentan en los totales del almacén. |
| Ocupación | Rack: Σ `quantity` (incluye reservadas). Contenedor, zona y almacén: Σ de sus racks activos sin staging (plan §4.3). |
| Nivel de ocupación | `occupancyLevel`: verde < 70 %, ámbar 70–90 % (inclusive) y rojo > 90 %; capacidad 0 → `none`. Igual que `CapacityBar` de F3. |
| Estado de una variante | Por sucursal, con `umbral = Branch.lowStockThreshold`: `AGOTADO` si `quantity` total = 0; `BAJO` si disponible ≤ umbral (incluye disponible 0 con unidades en piso); `DISPONIBLE` en otro caso. Banderas: `enPiso` (`reservedQty` > 0) y `enStaging` (unidades en staging). |
| Color | `Zone.color` y `Rack.labelColor` solo aceptan un color de `LOCATION_COLORS`. El color efectivo de un rack es `labelColor ?? zone.color`. |
| Códigos | Zona: 1–2 letras (`STG` reservado). Contenedor y rack: `01`–`99`. Si al crear no se indica código, se usa el siguiente libre. |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulos | `apps/api/src/modules/warehouse/` (`structure.routes.ts`, `structure.service.ts`, `tree.service.ts`, `labels.routes.ts`, `warehouse.repository.ts`) y `apps/api/src/modules/inventory/` (`inventory.routes.ts` e `inventory.queries.ts`, nuevos; `inventory.service.ts` de F2 se reutiliza). La búsqueda usa el lookup del módulo de productos (F6). Tags de Swagger `warehouse` e `inventory`. |
| Cambio de código | Siempre permitido (decisión del usuario). En una transacción se recalcula `locationCode` de todos los racks bajo el nodo. Un código o `locationCode` duplicado → 409 `CONFLICT` sin cambios. La respuesta trae `affectedRacks`. Queda en el audit `warehouse.code_change`, con el código anterior y el nuevo y la lista de `locationCode` viejos → nuevos. La UI pide confirmar antes: "Reimprime las etiquetas de N racks. Si reutilizas el código anterior, las etiquetas viejas apuntarán al rack nuevo." |
| Capacidad menor que la ocupación | Se permite (decisión del usuario); la respuesta trae `overCapacity: true` y la UI lo advierte. Las entradas a ese rack fallan con `RACK_CAPACITY_EXCEEDED` salvo *override* (F2). |
| *Override* de capacidad | `overrideCapacity: true` en ubicar, ubicar en lote, reubicar y ajuste de entrada exige `inventory.override_capacity`; sin él → 403 `FORBIDDEN` (`details.permission`). |
| Desactivar | Rack: solo si Σ `quantity` = 0 (→ 409 `RACK_HAS_STOCK` con los `locationCode`). Contenedor o zona: solo si ningún rack del subárbol tiene stock, y desactiva en cascada todo el subárbol. Reactivar afecta solo a ese nivel; un hijo no se reactiva con el padre inactivo (→ 409 `CONFLICT`). Los racks inactivos no reciben stock (F2) y no cuentan en los totales. |
| Borrar | Solo si ningún rack del subárbol tiene filas de `stock_location` ni movimientos (→ 409 `STRUCTURE_HAS_HISTORY`). Lo demás se desactiva. |
| Lote | `POST /zones/:id/containers/batch` (`count` 1–99, y opcionalmente `racksPerContainer` + `capacityUnits` + `labelColor`) y `POST /containers/:id/racks/batch` (`count`, `capacityUnits`, `labelColor?`). Los códigos siguen al último usado. Si superaría `99` → 409 `STRUCTURE_FULL` sin escrituras. |
| Árbol | `GET /warehouses/:id/tree`: zonas → contenedores → racks, con `capacity`, `occupied`, `reserved`, `free`, `pct` y `level` en cada nivel, más los totales del almacén (sin staging) y el bloque de staging aparte (solo ocupación). Por defecto sin inactivos (`includeInactive=true` los muestra). Con `status=AGOTADO\|BAJO\|EN_PISO\|EN_STAGING`, cada nodo trae `matchCount` (variantes de ese estado en el nodo). Se calcula con `v_rack_occupancy` y consultas agregadas (plan §12). |
| Contenido | `GET /racks/:id`, `/containers/:id` y `/zones/:id`: lista paginada de variantes con miniatura, SKU, nombre, variante, `quantity`, `reservedQty`, `available` y estado de la variante; en contenedor y zona, agregada por variante. Las filas con `quantity` 0 solo aparecen con `status=AGOTADO` (F2 conserva esas filas). |
| Búsqueda (`locate`) | `GET /inventory/locate?code=` resuelve con el lookup de F6 (variante, código de barras o SKU padre → todas sus variantes). Por variante devuelve: ubicaciones de la sucursal con `quantity` > 0 (por `locationCode`, staging al final), totales, estado y `otherBranches`. |
| Otras sucursales | Solo con `inventory.other_branches.read` (si no, `otherBranches: null`). Por cada sucursal **activa**, distinta de la actual, con disponibles > 0: `{ branchId, code, name, phone, available }`, donde `available` = Σ(`quantity − reservedQty`) de sus almacenes activos, incluido staging; ordenadas por `available` descendente. Incluye sucursales que el usuario no tiene asignadas: es solo lectura. F8 reutiliza `inventory.queries.otherBranchesStock()`. |
| Sugerencias | `GET /inventory/suggest-locations?variantId=&quantity=`: racks activos, sin staging, con `free ≥ quantity`. Orden: (1) racks que ya tienen la variante; (2) racks con otra variante del mismo producto; (3) el resto por `Zone.priority` ascendente (menor = zona preferida), `Zone.sortOrder` y `free` descendente. Máximo 10, cada uno con `reason` (`SAME_VARIANT`, `SAME_PRODUCT`, `FREE_SPACE`). Si ninguno alcanza, devuelve los 10 con más espacio libre y `fitsAll: false`. |
| Ubicar | `POST /inventory/putaway` con `source`. `STAGING` → `InventoryService.relocate` desde el rack de staging del almacén (`RELOCATE`; disponibles insuficientes → `STOCK_INSUFFICIENT`). `NEW` → `InventoryService.receive` con `PUTAWAY`. El destino no puede ser staging (400). La UI propone `STAGING` si la variante tiene disponibles en staging. |
| Ubicar en lote | `POST /inventory/putaway/batch`: un rack y hasta 100 ítems (variante, cantidad, origen), sin variantes repetidas, en **una** transacción: si uno falla, no se aplica ninguno. |
| Reubicar | `POST /inventory/relocate`: `items` **o** `all: true`. `all` mueve todas las unidades **disponibles** de cada variante del rack; las reservadas (en piso) se quedan. Se puede reubicar hacia staging. Una sola transacción. |
| Ajuste | `POST /inventory/adjust`: `direction` `IN` (→ `receive` `ADJUSTMENT_IN`, valida capacidad) u `OUT` (→ `adjustOut`, solo disponibles), con `reason` (`AdjustmentReason`) y `note` (1–300) obligatorios. Queda en el audit `inventory.adjust`. |
| Kardex | `GET /inventory/movements`: movimientos con origen o destino en almacenes de la sucursal actual. Filtros: `variantId` o `sku`, `rackId` o `locationCode`, `types[]`, `userId`, `from`/`to` (`YYYY-MM-DD`, inclusive, en `Branch.timezone`). Orden `createdAt` descendente, paginado. |
| Etiquetas | `GET /warehouses/:id/labels?scope=warehouse\|zone\|container\|rack&ids=`: racks del alcance (incluido staging), ordenados por `locationCode`, máximo 500. Cada uno con `qrPayload = toLocationQr(code)`, zona, contenedor, capacidad y color (hex y nombre). |
| Formatos de etiqueta (web) | **4×6"** (térmica): QR grande, código en letra muy grande, franja negra con el nombre del color en blanco, nombre de la zona y "Capacidad N". **50×25 mm** (térmica): QR y código. **Hoja A4 o Carta de 2×5** (10 por hoja): QR, código, zona, capacidad y banda en su color real (para impresora a color). Con `PrintLayout` y `QrCode` de F3. |
| Paleta | `LOCATION_COLORS` en `shared`: Rojo `#DC2626`, Naranja `#EA580C`, Amarillo `#EAB308`, Verde `#16A34A`, Turquesa `#0D9488`, Azul `#2563EB`, Morado `#7C3AED`, Rosa `#DB2777`, Café `#92400E` y Gris `#6B7280`. Los colores del seed de demo (Azul, Verde, Rojo) son de la paleta. |
| Audit | `warehouse.code_change`, `warehouse.deactivate`, `warehouse.delete` e `inventory.adjust`. Ubicar y reubicar ya quedan en el kardex. |
| UI | `/warehouse` (inicio con accesos según permisos), `/warehouse/map`, `/warehouse/search`, `/warehouse/putaway` (dos modos), `/warehouse/relocate`, `/warehouse/staging`, `/warehouse/movements`, `/warehouse/setup` y `/warehouse/labels`. Los flujos de operación (buscar, ubicar, reubicar) se completan con una mano: `ScanInput` con `captureHid`, botones ≥ 56 px, cantidad con − / + y sugerencias elegibles con un toque. |
| Consultas web | TanStack Query: `['warehouse-tree', id, filtros]`, `['rack', id]`, `['locate', code]`, `['movements', query]`. Toda operación de stock invalida el árbol, el contenido y `locate`. |

---

## 4. Dependencias autorizadas (lista cerrada)

Ninguna nueva.

---

## 5. Contratos en `packages/shared`

### 5.1 `warehouse.ts` (nuevo)

```ts
export const LOCATION_COLORS = [
  { name: 'Rojo', hex: '#DC2626' }, { name: 'Naranja', hex: '#EA580C' }, { name: 'Amarillo', hex: '#EAB308' },
  { name: 'Verde', hex: '#16A34A' }, { name: 'Turquesa', hex: '#0D9488' }, { name: 'Azul', hex: '#2563EB' },
  { name: 'Morado', hex: '#7C3AED' }, { name: 'Rosa', hex: '#DB2777' }, { name: 'Café', hex: '#92400E' },
  { name: 'Gris', hex: '#6B7280' },
] as const;
export const LocationColor = z.enum(LOCATION_COLORS.map((c) => c.hex));   // como tupla
export function colorName(hex: string | null): string | null;

export type OccupancyLevel = 'green' | 'amber' | 'red' | 'none';
export function occupancyLevel(occupied: number, capacity: number): OccupancyLevel;

export type StockStatus = 'AGOTADO' | 'BAJO' | 'DISPONIBLE';
export function variantStockStatus(
  s: { quantity: number; reservedQty: number; stagingQuantity: number }, lowStockThreshold: number,
): { status: StockStatus; enPiso: boolean; enStaging: boolean };

const SegmentCode = z.string().trim().transform((v) => v.padStart(2, '0')).pipe(SegmentCodeSchema); // F1
export const ZoneCreateInput = z.object({
  code: ZoneCodeSchema.refine((c) => c !== 'STG', 'STG está reservado').optional(),
  name: z.string().trim().min(1).max(60), color: LocationColor.nullable().default(null),
  priority: NonNegativeInt.default(0), sortOrder: NonNegativeInt.default(0),
});
export const ZoneUpdateInput = /* ZoneCreateInput.partial() estricto, ≥ 1 campo */;
export const ContainerCreateInput = z.object({ code: SegmentCode.optional(), name: z.string().trim().max(60).nullable().default(null) });
export const ContainerUpdateInput = /* parcial estricto, ≥ 1 campo */;
export const RackCreateInput = z.object({ code: SegmentCode.optional(), capacityUnits: NonNegativeInt, labelColor: LocationColor.nullable().default(null) });
export const RackUpdateInput = /* parcial estricto, ≥ 1 campo */;
export const ContainerBatchInput = z.object({
  count: z.number().int().min(1).max(99),
  racksPerContainer: z.number().int().min(1).max(99).optional(),
  capacityUnits: NonNegativeInt.optional(), labelColor: LocationColor.nullable().default(null),
}).refine((v) => !v.racksPerContainer || v.capacityUnits !== undefined, { path: ['capacityUnits'], message: 'Indica la capacidad de los racks' });
export const RackBatchInput = z.object({ count: z.number().int().min(1).max(99), capacityUnits: NonNegativeInt, labelColor: LocationColor.nullable().default(null) });

export const OccupancyDto = z.object({
  capacity: NonNegativeInt, occupied: NonNegativeInt, reserved: NonNegativeInt,
  free: z.number().int(), pct: z.number().nullable(), level: z.enum(['green', 'amber', 'red', 'none']),
});
export const RackNodeDto = RackDto.extend({ occupancy: OccupancyDto, colorHex: z.string().nullable(), matchCount: NonNegativeInt.optional() });
export const ContainerNodeDto = ContainerDto.extend({ occupancy: OccupancyDto, racks: z.array(RackNodeDto), matchCount: NonNegativeInt.optional() });
export const ZoneNodeDto = ZoneDto.extend({ occupancy: OccupancyDto, containers: z.array(ContainerNodeDto), matchCount: NonNegativeInt.optional() });
export const WarehouseTreeDto = z.object({
  warehouse: WarehouseDto, totals: OccupancyDto,
  staging: z.object({ rackId: Uuid, locationCode: z.string(), occupied: NonNegativeInt, reserved: NonNegativeInt }),
  zones: z.array(ZoneNodeDto),
});
export const StructureChangeDto = z.object({ affectedRacks: NonNegativeInt, overCapacity: z.boolean() });

export const LocationLabelDto = z.object({
  rackId: Uuid, locationCode: z.string(), qrPayload: z.string(),
  zoneCode: z.string(), zoneName: z.string(), containerName: z.string().nullable(),
  capacityUnits: NonNegativeInt, isStaging: z.boolean(),
  colorHex: z.string().nullable(), colorName: z.string().nullable(),
});
```

### 5.2 `inventory.ts` (nuevo)

```ts
export const StockStatusDto = z.object({ status: z.enum(['AGOTADO', 'BAJO', 'DISPONIBLE']), enPiso: z.boolean(), enStaging: z.boolean() });

export const ContentRowDto = z.object({
  variantId: Uuid, sku: z.string(), productName: z.string(), variantLabel: z.string().nullable(),
  thumbUrl: z.string().nullable(), quantity: NonNegativeInt, reservedQty: NonNegativeInt, available: NonNegativeInt,
  stock: StockStatusDto,                    // estado de la variante en la sucursal
});
export const ContentQuery = PaginationQuery.extend({ status: z.enum(['AGOTADO', 'BAJO', 'EN_PISO', 'EN_STAGING']).optional() });

export const LocationRowDto = z.object({
  rackId: Uuid, locationCode: z.string(), zoneName: z.string(), colorHex: z.string().nullable(),
  isStaging: z.boolean(), quantity: NonNegativeInt, reservedQty: NonNegativeInt, available: NonNegativeInt,
});
export const OtherBranchStockDto = z.object({ branchId: Uuid, code: z.string(), name: z.string(), phone: z.string().nullable(), available: Quantity });
export const LocateVariantDto = z.object({
  variant: VariantDetailDto,                 // F6
  totals: StockSummary, stock: StockStatusDto,
  locations: z.array(LocationRowDto),
  otherBranches: z.array(OtherBranchStockDto).nullable(),   // null = sin permiso
});
export const LocateResultDto = z.object({ product: ProductListItemDto, variants: z.array(LocateVariantDto) });

export const SuggestQuery = z.object({ variantId: Uuid, quantity: z.coerce.number().int().min(1).max(10_000) });
export const SuggestionDto = z.object({
  rackId: Uuid, locationCode: z.string(), zoneName: z.string(), colorHex: z.string().nullable(),
  free: z.number().int(), level: z.enum(['green', 'amber', 'red', 'none']),
  reason: z.enum(['SAME_VARIANT', 'SAME_PRODUCT', 'FREE_SPACE']),
});
export const SuggestionsDto = z.object({ fitsAll: z.boolean(), suggestions: z.array(SuggestionDto).max(10) });

export const PutawaySource = z.enum(['STAGING', 'NEW']);
export const PutawayInput = z.object({
  variantId: Uuid, rackId: Uuid, quantity: Quantity, source: PutawaySource, overrideCapacity: z.boolean().default(false),
});
export const PutawayBatchInput = z.object({
  rackId: Uuid, overrideCapacity: z.boolean().default(false),
  items: z.array(z.object({ variantId: Uuid, quantity: Quantity, source: PutawaySource })).min(1).max(100),
}).refine(/* sin variantId repetido */);
export const RelocateInput = z.object({
  fromRackId: Uuid, toRackId: Uuid, overrideCapacity: z.boolean().default(false),
  items: z.array(z.object({ variantId: Uuid, quantity: Quantity })).min(1).max(200).optional(),
  all: z.literal(true).optional(),
}).refine((v) => Boolean(v.items) !== Boolean(v.all), 'Indica los productos o "todo", no ambos')
  .refine((v) => v.fromRackId !== v.toRackId, { path: ['toRackId'], message: 'El destino debe ser distinto del origen' });
export const AdjustInput = z.object({
  variantId: Uuid, rackId: Uuid, direction: z.enum(['IN', 'OUT']), quantity: Quantity,
  reason: AdjustmentReason, note: z.string().trim().min(1, 'La nota es obligatoria').max(300),
  overrideCapacity: z.boolean().default(false),
});
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string>;  // Conteo físico, Merma o daño, …

export const StockOperationDto = z.object({
  movements: z.array(InventoryMovementDto), balances: z.array(z.object({ rackId: Uuid, variantId: Uuid, quantity: NonNegativeInt, reservedQty: NonNegativeInt })),
});

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const MovementListQuery = PaginationQuery.extend({
  variantId: Uuid.optional(), sku: z.string().trim().optional(),
  rackId: Uuid.optional(), locationCode: z.string().trim().optional(),
  types: z.preprocess((v) => (typeof v === 'string' ? v.split(',') : v), z.array(InventoryMovementType)).optional(),
  userId: Uuid.optional(), from: LocalDate.optional(), to: LocalDate.optional(),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { path: ['to'], message: '"Hasta" debe ser igual o posterior a "Desde"' });
export const MovementRowDto = InventoryMovementDto.extend({
  sku: z.string(), productName: z.string(), variantLabel: z.string().nullable(),
  fromLocationCode: z.string().nullable(), toLocationCode: z.string().nullable(),
  user: z.object({ id: Uuid, fullName: z.string() }),
});
```

### 5.3 `errors.ts`

| Código | HTTP | Mensaje |
|---|---|---|
| `RACK_HAS_STOCK` | 409 | "No se puede desactivar: hay stock en estas ubicaciones." (`details.locationCodes`) |
| `STRUCTURE_HAS_HISTORY` | 409 | "Tiene movimientos registrados; desactívalo en su lugar." |
| `STRUCTURE_LOCKED` | 409 | "La zona de staging no se puede modificar." |
| `STRUCTURE_FULL` | 409 | "Se alcanzó el máximo de 99 contenedores o racks." |

---

## 6. Endpoints

Todos bajo `/api/v1`. Las respuestas de error son `ApiErrorDto`. `:id` de almacén, zona, contenedor o rack debe pertenecer a un almacén de las sucursales del actor (`branchIds`); si no → 403 `BRANCH_FORBIDDEN`.

**Estructura** (tag `warehouse`)

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /warehouses` | `warehouse.read`, `branchScoped` | — | 200 `WarehouseDto[]` (de la sucursal actual) |
| `GET /warehouses/:id/tree` | `warehouse.read` | `includeInactive?`, `status?` | 200 `WarehouseTreeDto` |
| `POST /warehouses/:id/zones` | `warehouse.manage` | `ZoneCreateInput` | 201 `ZoneDto` · 400 · 409 |
| `PATCH /zones/:id` | `warehouse.manage` | `ZoneUpdateInput` | 200 `ZoneDto` + `StructureChangeDto` · 409 (`CONFLICT`, `STRUCTURE_LOCKED`) |
| `POST /zones/:id/containers` | `warehouse.manage` | `ContainerCreateInput` | 201 `ContainerDto` · 409 (`STRUCTURE_FULL`, `STRUCTURE_LOCKED`) |
| `POST /zones/:id/containers/batch` | `warehouse.manage` | `ContainerBatchInput` | 201 `ContainerDto[]` · 409 |
| `PATCH /containers/:id` | `warehouse.manage` | `ContainerUpdateInput` | 200 + `StructureChangeDto` · 409 |
| `POST /containers/:id/racks` | `warehouse.manage` | `RackCreateInput` | 201 `RackDto` · 409 |
| `POST /containers/:id/racks/batch` | `warehouse.manage` | `RackBatchInput` | 201 `RackDto[]` · 409 `STRUCTURE_FULL` |
| `PATCH /racks/:id` | `warehouse.manage` | `RackUpdateInput` | 200 + `StructureChangeDto` · 409 |
| `POST /{zones\|containers\|racks}/:id/deactivate` | `warehouse.manage` | — | 200 · 409 (`RACK_HAS_STOCK`, `STRUCTURE_LOCKED`) |
| `POST /{zones\|containers\|racks}/:id/reactivate` | `warehouse.manage` | — | 200 · 409 (`CONFLICT` si el padre está inactivo) |
| `DELETE /{zones\|containers\|racks}/:id` | `warehouse.manage` | — | 204 · 409 (`STRUCTURE_HAS_HISTORY`, `STRUCTURE_LOCKED`) |
| `GET /{zones\|containers\|racks}/:id` | `warehouse.read` | `ContentQuery` | 200 nodo + `paginated(ContentRowDto)` |
| `GET /warehouses/:id/labels` | `warehouse.labels` | `scope`, `ids` | 200 `LocationLabelDto[]` · 400 (más de 500) |

**Inventario** (tag `inventory`, todas `branchScoped`)

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /inventory/locate` | `warehouse.read` | `code` | 200 `LocateResultDto` · 404 |
| `GET /inventory/by-location` | `warehouse.read` | `code` + `ContentQuery` | 200 rack + `paginated(ContentRowDto)` · 404 |
| `GET /inventory/suggest-locations` | `inventory.putaway` | `SuggestQuery` | 200 `SuggestionsDto` |
| `POST /inventory/putaway` | `inventory.putaway` (+ `inventory.override_capacity` si aplica) | `PutawayInput` | 200 `StockOperationDto` · 400 · 403 · 409 (`STOCK_INSUFFICIENT`, `RACK_CAPACITY_EXCEEDED`, `RACK_INACTIVE`) |
| `POST /inventory/putaway/batch` | ídem | `PutawayBatchInput` | 200 `StockOperationDto` · ídem (con `details.itemIndex`) |
| `POST /inventory/relocate` | `inventory.relocate` (+ override) | `RelocateInput` | 200 `StockOperationDto` · 409 (`STOCK_INSUFFICIENT`, `RACK_CAPACITY_EXCEEDED`, `INVENTORY_CROSS_WAREHOUSE`) |
| `POST /inventory/adjust` | `inventory.adjust` (+ override) | `AdjustInput` | 200 `StockOperationDto` · 400 · 403 · 409 |
| `GET /inventory/movements` | `inventory.movements.read` | `MovementListQuery` | 200 `paginated(MovementRowDto)` |

---

## 7. Seed de demo con stock

`seedDemo` (F1) agrega, después de la estructura y el catálogo, una sección de stock que corre solo si no existe ningún movimiento con `note: 'Demo'` (idempotente). Usa `InventoryService.receive` (`INITIAL_LOAD`, `note: 'Demo'`, `userId` del `owner`):

| Sucursal | Ubicación | Stock |
|---|---|---|
| `S1` | `A-01-01` | `ZAP0101-23-NEG` 3, `ZAP0101-24-NEG` 3, `ZAP0101-25-NEG` 4 |
| `S1` | `A-01-02` | `ZAP0101-25-CAF` 1 (stock bajo), `ZAP0101-26-CAF` 2 |
| `S1` | `B-01-01` | `BOL0201-NEG` 5, `BOL0201-ROJ` 2 |
| `S1` | `C-01-01` | `ACC0301` 10 |
| `S1` | `STG-01-01` | `ZAP0102-26-BLA` 2 (pendiente de ubicar) |
| `S2` | `STG-01-01` | `ZAP0101-26-NEG` 2, `ZAP0102-25-BLA` 1 |

`ZAP0101-26-NEG` no tiene stock en `S1` (agotado ahí y disponible en `S2`), para probar "En otras sucursales".

---

## 8. Pantallas (wireframe en texto)

**Inicio (`/warehouse`)**: accesos grandes según permisos: Mapa · Buscar · Ubicar · Reubicar · Staging (con contador) · Kardex · Configurar · Etiquetas.

**Mapa (`/warehouse/map`)**

```
  Almacén principal        [Agotado][Bajo][En piso][Staging]
  Total ████████░░ 312/480 (65 %)       Staging: 12 pzas
  ▸ A · Calzado dama  ████████░ 150/160 (94 %)  🔴
     ▸ A-01           ███████░░  70/80  (88 %)  🟠
        A-01-01 ███░ 10/40   A-01-02 ███ 3/40 …
  ▸ B · Bolsos        ████░░░░  80/160 (50 %)  🟢
```

Tocar un rack abre su contenido: miniatura, SKU, variante, cantidad, reservadas y estado ("Bajo", "En piso"). Con un filtro activo, cada nodo muestra cuántas variantes coinciden.

**Buscar (`/warehouse/search`)**

```
  [ Escanea o escribe un SKU ] [📷]
  Zapato de piel dama · 25 Negro         ● Disponible
  ┌──────────────────────────────────┐
  │ 🟦 A-01-01   4 pzas (1 en piso)   │
  │ ⬜ STG-01-01 2 pzas  (staging)    │
  └──────────────────────────────────┘
  En otras sucursales                       ← con inventory.other_branches.read
  Sucursal 2 · 55 1234 5678 · 2 disponibles
```

Con un SKU padre se listan sus variantes y se elige una.

**Ubicar, "producto primero"**: escanear el producto → (elegir variante) → sugerencias tocables ("A-01-01 · 30 libres · ya está aquí") o escanear una ubicación → cantidad con − / + (por defecto, lo que hay en staging o 1) → origen [Desde staging (2)] [Mercancía nueva] → [Confirmar].

**Ubicar, "ubicación primero"**: escanear la ubicación → escanear productos sin parar (cada lectura suma 1; la misma variante incrementa su fila) → lista editable con origen por fila → [Confirmar lote].

**Reubicar**: escanear el origen → lista con casillas y − / +, o [Todo] → escanear el destino → [Confirmar].

**Capacidad excedida** (en cualquier flujo): "A-01-02 no tiene espacio (38/40, entran 5)". Con `inventory.override_capacity` aparece "Exceder capacidad" (confirmación); sin él, solo "Elegir otra ubicación".

**Staging**: lista de variantes con su cantidad y el botón [Ubicar], que abre "producto primero" con origen staging.

**Ajustar** (diálogo desde el contenido de un rack o desde Buscar, con `inventory.adjust`): [Entrada | Salida] · cantidad · motivo (lista) · nota (obligatoria) · [Guardar].

**Kardex**: filtros (SKU, ubicación, tipo, usuario, desde/hasta) y tabla o tarjetas: fecha, tipo, SKU, de → a, cantidad, usuario, motivo y nota.

**Configurar (`/warehouse/setup`)**: árbol editable con [+ Zona], [+ Contenedor], [+ Rack] y [Crear en lote] (asistente: N contenedores con M racks de capacidad C); nombre, color (paleta con nombres), prioridad y capacidad; menú del nodo con Editar código (pide confirmar la reimpresión), Desactivar, Reactivar y Eliminar. Staging aparece con candado.

**Etiquetas (`/warehouse/labels`)**: alcance (almacén, zona, contenedor o rack) y formato [4×6" | 50×25 mm | Hoja A4 | Hoja Carta] → vista previa → [Imprimir].

```
  4×6"                       50×25 mm         Hoja (2×5, a color)
  ┌──────────────────┐       ┌───────────┐    ┌────────┬────────┐
  │   ▓▓▓▓▓▓▓▓▓▓     │       │▓▓▓ A-01-03│    │▓▓ A-01-01│▓▓ A-01-02│
  │   ▓▓  QR  ▓▓     │       │▓▓▓        │    │ ▬▬ Azul ▬│ ▬▬ Azul ▬│
  │   A-01-03        │       └───────────┘    │ …        │ …        │
  │ ███ AZUL ███████ │  ← franja negra con el nombre del color
  │ Calzado dama     │
  │ Capacidad 40     │
  └──────────────────┘
```

---

## 9. Reglas y casos borde

1. **Cambio de código con stock:** se permite; las etiquetas impresas quedan viejas y la UI lo advierte. Si se reutiliza un código viejo, las etiquetas viejas apuntan al rack nuevo.
2. **Código duplicado** (zona en el almacén, contenedor en la zona, rack en el contenedor): 409 `CONFLICT` sin cambios.
3. **Capacidad por debajo de la ocupación:** se guarda con aviso; el rack se ve en rojo por encima del 100 % y no recibe entradas sin *override*.
4. **Desactivar con stock:** 409 `RACK_HAS_STOCK` con las ubicaciones; primero hay que reubicar.
5. **Staging:** no se edita ni se agrega estructura (409 `STRUCTURE_LOCKED`); sí se ubica desde staging y se reubica hacia staging.
6. **Ubicar desde staging sin unidades suficientes:** `STOCK_INSUFFICIENT` con `available`.
7. **Lote con un ítem que falla:** no se aplica ningún ítem; el error trae `itemIndex`.
8. **"Todo" en reubicar:** las unidades reservadas (en piso) se quedan en el origen.
9. **Reubicar a otro almacén o sucursal:** `INVENTORY_CROSS_WAREHOUSE` (las transferencias son post-MVP).
10. **Ajuste sin nota o sin motivo:** 400. Una salida mayor que lo disponible: `STOCK_INSUFFICIENT`.
11. **Otras sucursales:** solo activas, distintas de la actual, con disponibles > 0; sin el permiso, `otherBranches: null` y la UI oculta la sección.
12. **Escaneos que no son producto ni ubicación** (promoción): "Este código es de una promoción, no de un producto".
13. **Dos usuarios ubican en el mismo rack a la vez:** los bloqueos de F2 serializan; uno puede recibir `RACK_CAPACITY_EXCEEDED`.
14. **Kardex por fecha:** `from`/`to` se interpretan en la zona horaria de la sucursal (un movimiento a las 23:30 hora local pertenece a ese día).

---

## 10. TODOs (en orden, verificables)

- [ ] **1. Contratos.**
  - `shared/warehouse.ts`, `shared/inventory.ts` y los 4 códigos de error (también en la API). Tests **T1–T5**.
  - *Verificable:* T1–T5 en verde.
- [ ] **2. API: estructura.**
  - `warehouse.repository.ts`, `structure.service.ts` y `structure.routes.ts` (crear, lote, editar con recálculo, desactivar, reactivar, borrar, staging bloqueada); registrar en `app.ts`. Tests **T6–T13**.
  - *Verificable:* T6–T13 en verde.
- [ ] **3. API: árbol y contenido.**
  - `tree.service.ts` y las rutas de contenido. Tests **T14–T15**.
  - *Verificable:* T14–T15 en verde.
- [ ] **4. API: búsqueda y sugerencias.**
  - `inventory.queries.ts` (`locate`, `byLocation`, `otherBranchesStock`, `suggest`) y sus rutas. Tests **T16–T19**.
  - *Verificable:* T16–T19 en verde.
- [ ] **5. API: operaciones.**
  - Ubicar (individual y lote), reubicar y ajustar en `inventory.routes.ts` sobre `InventoryService`. Tests **T20–T23** y **T26**.
  - *Verificable:* T20–T23 y T26 en verde.
- [ ] **6. API: kardex y etiquetas.**
  - `GET /inventory/movements` y `labels.routes.ts`. Tests **T24–T25**.
  - *Verificable:* T24–T25 en verde.
- [ ] **7. Seed de demo con stock.**
  - Extender `prisma/seed/demo.ts` (§7) y adaptar T24 de F1. Test **T27**.
  - *Verificable:* T27 y el T24 adaptado en verde; `pnpm seed:demo` dos veces no duplica stock.
- [ ] **8. UI: inicio, mapa y buscar.**
  - `WarehouseHomePage`, `WarehouseMapPage`, `RackContent` y `SearchPage`. Tests **T28–T30**.
  - *Verificable:* T28–T30 en verde.
- [ ] **9. UI: ubicar, reubicar y staging.**
  - `PutawayPage` (dos modos), `RelocatePage`, `StagingPage` y el diálogo de capacidad excedida. Tests **T31–T34**.
  - *Verificable:* T31–T34 en verde.
- [ ] **10. UI: ajuste y kardex.**
  - `AdjustDialog` y `MovementsPage`. Tests **T35–T36**.
  - *Verificable:* T35–T36 en verde.
- [ ] **11. UI: configurar y etiquetas.**
  - `SetupPage` (árbol editable, asistente de lote, paleta, cambio de código) y `LocationLabelsPage` (3 formatos). Tests **T37–T38**.
  - *Verificable:* T37–T38 en verde, y la vista previa de impresión muestra cada formato.
- [ ] **12. README y cierre.**
  - En el README: configurar el almacén, flujos de ubicar y reubicar, etiquetas y kardex.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales (§12); registrar la cobertura; llenar §13 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 11. Tests requeridos (lista cerrada: 38)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (`S1` y `S2`) más los datos de cada test (o el seed de demo donde se indica). Los de `web` usan Jest + RTL con `fetch` simulado.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `warehouse.test.ts` | `occupancyLevel` (`it.each`): 0/40 y 27/40 verde; 28/40 y 36/40 ámbar; 37/40 y 45/40 rojo; capacidad 0 → `none`. |
| T2 | `shared` · `warehouse.test.ts` | `variantStockStatus` (`it.each`, umbral 2): `quantity` 0 → `AGOTADO`; disponible 2 → `BAJO`; disponible 0 con 3 reservadas → `BAJO` + `enPiso`; disponible 5 → `DISPONIBLE`; con unidades en staging → `enStaging`. |
| T3 | `shared` · `warehouse.test.ts` | Entradas de estructura: zona `A` y `AB` válidas, `STG` y `A1` → error; color fuera de la paleta → error; contenedor `"1"` → `"01"`, `"100"` → error; lote con `racksPerContainer` sin capacidad → error; los `Update` sin campos o con claves desconocidas → error. `LOCATION_COLORS` tiene 10 colores con hex y nombre únicos; `colorName('#2563EB')` → `"Azul"`. |
| T4 | `shared` · `inventory.test.ts` | `PutawayBatchInput` con variante repetida o 101 ítems → error; `RelocateInput` con `items` y `all` a la vez, sin ninguno o con el mismo rack → error; `AdjustInput` sin nota o con motivo inválido → error; `MovementListQuery`: `types=PUTAWAY,RELOCATE` → arreglo, `to` anterior a `from` → error. |
| T5 | `shared` · `errors.test.ts` + `inventory.test.ts` | Los 4 códigos nuevos existen. `ADJUSTMENT_REASON_LABELS` cubre los 6 motivos. Las fixtures de `WarehouseTreeDto`, `LocateResultDto` (con y sin `otherBranches`), `SuggestionsDto`, `MovementRowDto` y `LocationLabelDto` son válidas. |
| T6 | `int` · `warehouse-structure.int.test.ts` | `GET /warehouses` devuelve `ALM1` de la sucursal actual; con `X-Branch-Id` de `S2` (actor con acceso), el de `S2`; un `:id` de almacén de una sucursal no asignada → 403 `BRANCH_FORBIDDEN`. |
| T7 | `int` · `warehouse-structure.int.test.ts` | Crear zona sin código → siguiente letra libre; contenedor y rack sin código → `01`, `02`…; el rack nuevo tiene `locationCode` correcto; color fuera de la paleta → 400; un usuario sin `warehouse.manage` → 403. |
| T8 | `int` · `warehouse-structure.int.test.ts` | Lote de 10 racks de capacidad 40 en `A-01` → `A-01-01`…`A-01-10`; con racks `01`–`03` ya existentes, el lote empieza en `04`; un lote que pasaría de `99` → 409 `STRUCTURE_FULL` sin escrituras; lote de 3 contenedores con 4 racks cada uno → 12 racks. |
| T9 | `int` · `warehouse-structure.int.test.ts` | Cambiar la zona `A` a `D` con stock en sus racks → todos sus `locationCode` pasan a `D-…`, el stock se conserva, `affectedRacks` correcto y `AuditLog` `warehouse.code_change` con los códigos viejos y nuevos; cambiar a un código existente → 409 `CONFLICT` sin cambios; cambiar el código de un rack afecta solo a ese rack. |
| T10 | `int` · `warehouse-structure.int.test.ts` | Bajar la capacidad a menos que la ocupación → 200 con `overCapacity: true`; el árbol muestra `pct` > 100 y nivel rojo; ubicar `NEW` ahí → 409 `RACK_CAPACITY_EXCEEDED`; con `overrideCapacity` y el permiso → OK; con `overrideCapacity` sin el permiso → 403. |
| T11 | `int` · `warehouse-structure.int.test.ts` | Desactivar un rack con stock → 409 `RACK_HAS_STOCK` con su código; desactivar un contenedor sin stock desactiva sus racks; reactivar un rack con el contenedor inactivo → 409; el árbol por defecto no muestra inactivos y con `includeInactive=true` sí; `AuditLog` `warehouse.deactivate`. |
| T12 | `int` · `warehouse-structure.int.test.ts` | Borrar un rack nunca usado → 204; uno con movimientos → 409 `STRUCTURE_HAS_HISTORY`; borrar una zona cuyos racks nunca se usaron borra todo su subárbol. |
| T13 | `int` · `warehouse-structure.int.test.ts` | Editar, desactivar o borrar la zona, el contenedor o el rack de staging → 409 `STRUCTURE_LOCKED`; agregar un contenedor a `STG` o un rack a su contenedor → 409. |
| T14 | `int` · `warehouse-tree.int.test.ts` | Con stock en 6 racks de 2 zonas: la ocupación de cada contenedor, zona y del almacén es igual a la suma de sus racks activos (CA del plan); staging no suma en los totales y aparece aparte; los racks inactivos no cuentan; `level` correcto; con `status=BAJO`, `matchCount` correcto por nodo. |
| T15 | `int` · `warehouse-tree.int.test.ts` | `GET /racks/:id` → filas paginadas con miniatura, cantidades y estado; una fila con `quantity` 0 solo aparece con `status=AGOTADO`; `GET /containers/:id` y `/zones/:id` agregan por variante. |
| T16 | `int` · `inventory-api-locate.int.test.ts` | `locate` por SKU de variante → una variante; por SKU padre → todas; ubicaciones sin las de `quantity` 0 y con staging al final; totales y estado correctos; código desconocido → 404. |
| T17 | `int` · `inventory-api-locate.int.test.ts` | Con `inventory.other_branches.read`: `S2` aparece con su teléfono y `available` (incluye staging y excluye reservadas), aunque el vendedor no tenga `S2` asignada; una sucursal inactiva o con 0 disponibles no aparece; la sucursal actual nunca aparece. Sin el permiso (Almacenista) → `otherBranches: null`. |
| T18 | `int` · `inventory-api-locate.int.test.ts` | `by-location` con `a-1-1` → contenido de `A-01-01`; un código que solo existe en el almacén de otra sucursal → 404; un código inválido → 404. |
| T19 | `int` · `inventory-api-suggest.int.test.ts` | El orden es: racks con la misma variante, luego con el mismo producto, luego por `priority` de zona y espacio libre; excluye racks llenos, inactivos y staging; máximo 10; si ninguno alcanza → `fitsAll: false` con los de más espacio. Sin `inventory.putaway` → 403. |
| T20 | `int` · `inventory-api-putaway.int.test.ts` | `source: 'STAGING'` → movimiento `RELOCATE` desde `STG-01-01` y staging disminuye; staging insuficiente → 409 `STOCK_INSUFFICIENT`; `source: 'NEW'` → `PUTAWAY` y suma stock; destino staging → 400; sin `inventory.putaway` → 403. |
| T21 | `int` · `inventory-api-putaway.int.test.ts` | Lote de 3 ítems (origen mixto) → un solo `StockOperationDto` con 3 movimientos; si el tercero excede la capacidad → 409 con `itemIndex: 2` y ninguno se aplica; con *override* y permiso → OK con `capacityOverridden`. |
| T22 | `int` · `inventory-api-relocate.int.test.ts` | Reubicar ítems → `RELOCATE`; `all: true` con 2 unidades reservadas (`pick` de F2) mueve solo las disponibles; hacia staging → OK; hacia un rack de `S2` → 409 `INVENTORY_CROSS_WAREHOUSE`; destino lleno → `RACK_CAPACITY_EXCEEDED`. |
| T23 | `int` · `inventory-api-adjust.int.test.ts` | Entrada con motivo y nota → `ADJUSTMENT_IN` con `adjustmentReason` guardado y `AuditLog` `inventory.adjust`; salida mayor que lo disponible → `STOCK_INSUFFICIENT`; sin nota → 400; Vendedor y Almacenista (sin `inventory.adjust`) → 403. |
| T24 | `int` · `inventory-api-movements.int.test.ts` | Filtros por `sku`, `locationCode`, `types` y `userId`; orden descendente y paginación; un movimiento a las `2026-10-02T05:30:00Z` aparece con `from=to=2026-10-01` (Ciudad de México) y no con `2026-10-02`; los movimientos de `S2` no aparecen en `S1`; Vendedor (sin `inventory.movements.read`) → 403. |
| T25 | `int` · `warehouse-labels.int.test.ts` | `scope` `rack`, `container`, `zone` y `warehouse` devuelven el conjunto esperado, ordenado; `qrPayload` = `LOC:A-01-03`; el color sale del rack o, si no tiene, de la zona, con su nombre; más de 500 → 400; sin `warehouse.labels` → 403. |
| T26 | `int` · `inventory-api-concurrency.int.test.ts` | Rack con 3 libres: dos `putaway` `NEW` de 2 en paralelo → uno 200 y otro 409 `RACK_CAPACITY_EXCEEDED`; ocupación final = capacidad − 1. |
| T27 | `int` · `seed-demo.int.test.ts` | Tras el seed base y el de demo: el stock de §7 en `S1` y en el staging de `S2`, con movimientos `INITIAL_LOAD` y `note: 'Demo'`; `ZAP0101-26-NEG` agotado en `S1` y disponible en `S2`; una segunda corrida no duplica stock. (Reemplaza la verificación de "0 `stock_location`" de T24 de F1.) |
| T28 | `web` · `WarehouseHomePage.test.tsx` | `it.each` por rol: Vendedor → Mapa, Buscar y Reubicar; Almacenista → todo menos Ajustar; Gerente → todo. El contador de Staging muestra las unidades pendientes. |
| T29 | `web` · `WarehouseMapPage.test.tsx` | Muestra el árbol con `CapacityBar` por nivel y los totales; staging como "Sin límite"; tocar un rack abre su contenido con el estado de cada variante; un filtro agrega `status` a la consulta y muestra `matchCount`. |
| T30 | `web` · `SearchPage.test.tsx` | Un escaneo de producto llama a `locate` y lista las ubicaciones con su color; con `otherBranches` muestra "En otras sucursales" con nombre, teléfono y disponibles; con `otherBranches: null` no muestra la sección; un SKU padre pide elegir la variante; un escaneo de promoción muestra su aviso. |
| T31 | `web` · `PutawayPage.test.tsx` | "Producto primero": tras escanear, se muestran las sugerencias; tocar una (o escanear una ubicación) la elige; la cantidad cambia con − / +; con unidades en staging el origen por defecto es "Desde staging (N)"; "Confirmar" envía `PutawayInput`. |
| T32 | `web` · `PutawayPage.test.tsx` | "Ubicación primero": tras escanear la ubicación, 3 escaneos de la misma variante y 1 de otra → 2 filas (3 y 1); la cantidad se edita; "Confirmar lote" envía `PutawayBatchInput`; un 409 de capacidad muestra "Exceder capacidad" solo con `inventory.override_capacity`. |
| T33 | `web` · `RelocatePage.test.tsx` | Escanear el origen lista su contenido; marcar ítems y ajustar cantidades, o "Todo"; escanear el destino; "Confirmar" envía `RelocateInput`; destino igual al origen muestra el error sin llamar a la API. |
| T34 | `web` · `StagingPage.test.tsx` | Lista las variantes en staging con su cantidad; "Ubicar" abre "producto primero" con esa variante y origen staging. |
| T35 | `web` · `AdjustDialog.test.tsx` | Muestra los 6 motivos en español; la nota es obligatoria; envía `AdjustInput` con dirección, cantidad, motivo y nota; sin `inventory.adjust` la acción "Ajustar" no aparece. |
| T36 | `web` · `MovementsPage.test.tsx` | Los filtros se traducen a `MovementListQuery` (fechas `YYYY-MM-DD`, tipos separados por coma); la tabla muestra fecha (en la zona de la sucursal), tipo, SKU, de → a, cantidad, usuario, motivo y nota. |
| T37 | `web` · `SetupPage.test.tsx` | El asistente de lote envía `ContainerBatchInput`; la paleta muestra los 10 colores con su nombre; editar un código muestra "Reimprime las etiquetas de N racks…" y solo envía el `PATCH` al confirmar; bajar la capacidad por debajo de la ocupación muestra el aviso; staging aparece bloqueada. |
| T38 | `web` · `LocationLabelsPage.test.tsx` | `it.each` de formatos: 4×6 → `QrCode` con `LOC:…`, código grande, franja negra con el nombre del color, zona y capacidad; 50×25 → QR y código, sin franja; hoja A4 y Carta → 10 por hoja (11 → 2 hojas) con la banda en su color real; "Imprimir" usa `PrintLayout` con el tamaño correcto. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F6 siguen en verde (T24 de F1 adaptado, §1).

---

## 12. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | La ocupación de contenedor, zona y almacén coincide siempre con la suma de sus racks. | T14 |
| CA2 | Ninguna operación deja stock negativo ni supera la capacidad sin permiso, tampoco con 2 usuarios en el mismo rack a la vez. | T10, T20–T23, T26 + F2 T38–T40 |
| CA3 | Cada operación genera su movimiento en el kardex, con usuario, fecha y, en ajustes, motivo y nota. | T20–T24 |
| CA4 | Buscar muestra las ubicaciones de un producto y, con permiso, las existencias en otras sucursales. | T16, T17, T30 |
| CA5 | El cambio de código recalcula las ubicaciones y advierte la reimpresión de etiquetas. | T9, T37 |
| CA6 | Todo el flujo de ubicar y reubicar se completa con una sola mano en el celular, sin teclear (solo escaneos y toques). | Verificación manual en Android y iPhone (dispositivo, fecha y responsable en §13) |
| CA7 | Las etiquetas de ubicación (4×6 y 50×25 en la Ribetec, hoja a color en impresora normal) se leen con la cámara y con el lector, y el escaneo lleva a la ubicación correcta. | T38 + verificación manual |
| CA8 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F6. | Salida de los comandos en §13 |
| CA9 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §13 |

---

## 13. Evidencia

*(Se completa al cerrar la fase.)*

---

## 14. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-03 | Ajustes con motivo de una lista fija (Conteo físico, Merma o daño, Extravío, Hallazgo, Error de captura, Otro) y nota obligatoria; el motivo se guarda en `InventoryMovement.adjustmentReason`. | Usuario (chat); F1 §4.1, §4.5 y §5.1, F2 §8 y plan §8 F7 actualizados |
| 2026-10-03 | Los códigos de zona, contenedor y rack se pueden cambiar siempre, con aviso de reimpresión. | Usuario (chat); plan §8 F7 actualizado |
| 2026-10-03 | La capacidad se puede bajar por debajo de la ocupación, con aviso; las entradas quedan bloqueadas sin *override*. | Usuario (chat); plan §8 F7 actualizado |
| 2026-10-03 | Etiquetas de ubicación en térmica 4×6" (franja negra con el nombre del color), térmica 50×25 mm y hoja A4 o Carta a color. | Usuario (chat); plan §8 F7 actualizado |
| 2026-10-03 | Ubicar toma de staging (`RELOCATE`, por defecto si hay) o registra mercancía nueva (`PUTAWAY`). | Usuario (chat); plan §8 F7 actualizado |
| 2026-10-03 | Paleta fija de 10 colores con nombre, para que la térmica imprima el nombre. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | "Zona preferida" = `Zone.priority` menor; sugerencias: misma variante, mismo producto, luego espacio libre. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Ubicar en lote (modo "ubicación primero") es una sola transacción: todo o nada. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | "Todo" en reubicar mueve solo unidades disponibles; las reservadas se quedan. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Desactivar contenedor o zona desactiva su subárbol; reactivar es por nivel; borrar solo sin historial. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | La estructura de staging es fija. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `BAJO` incluye disponible 0 con unidades en piso (`AGOTADO` solo si no hay ninguna unidad). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Hoja de etiquetas de ubicación de 2×5 (10 por hoja). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Stock de demo según §7, con `ZAP0101-26-NEG` agotado en `S1` y disponible en `S2`; T24 de F1 se adapta (regresión declarada). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Audit de `warehouse.code_change`, `warehouse.deactivate`, `warehouse.delete` e `inventory.adjust`; 4 códigos de error nuevos. | Propuesta del agente; revisar al aprobar |
