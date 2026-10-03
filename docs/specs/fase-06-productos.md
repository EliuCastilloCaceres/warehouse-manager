---
id: fase-06
titulo: Productos
estado: LISTA
depende_de: [fase-04]
autoriza_codigo_en:
  - "apps/api/package.json"
  - "apps/web/package.json"
  - "pnpm-lock.yaml"
  - "apps/api/src/modules/products/**"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/core/errors.test.ts"
  - "apps/api/src/app.ts"
  - "apps/api/test/integration/products-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/products.ts"
  - "packages/shared/src/products.test.ts"
  - "packages/shared/src/productImport.ts"
  - "packages/shared/src/productImport.test.ts"
  - "packages/shared/src/sku.ts"
  - "packages/shared/src/sku.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "apps/web/src/features/products/**"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Estructura del almacén, mapa, ubicar, reubicar, ajustes de stock y kardex (F7); F6 solo registra existencia desde la carga masiva"
  - "Pantallas propias para crear, editar o borrar categorías y marcas; se crean al guardar un producto o al importar"
  - "Exportar el catálogo a .xlsx"
  - "Columna de código de barras en la carga masiva (se captura en el formulario)"
  - "Generar códigos EAN propios"
  - "Borrar archivos de imágenes quitadas o huérfanas"
  - "Precios por sucursal, listas de precios y promociones (post-MVP)"
  - "Reservas, venta y lectura de stock por ubicación (F7/F8)"
  - "Cambios a schema.prisma o migraciones (el modelo es de F1; si hiciera falta, se pregunta)"
tests_requeridos_total: 35
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/products/**, apps/web/src/features/products/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 6: Productos

## 1. Contexto y alcance

Referencias: plan §3 (convenciones: dinero, SKU, paginación), §4.2 (catálogo), §4.3 (carga masiva sin ubicación → staging), §5.3 (contenido de los códigos), §7 (escaneo e impresión), §8 Fase 6, §12 (datos sucios en la carga masiva) y §13.7 (imágenes por variante). Se apoya en F1 (modelo, `SkuSchema`, `normalizeSku`, `parseMoney`, `parseLocationCode`, `classifyScan`, DTOs de catálogo), F2 (acceso, `branchContext`, `POST /uploads/product-images`, `InventoryService.receive`, `AuditService`, paginación), F3 (`apiFetch`, `DataTable`, `ScanInput`, `PrintLayout`, `Barcode`, `QrCode`, `useMediaQuery`) y F5 (`apiFetch` con `FormData`).

**Objetivo:** catálogo completo con variantes, imágenes, carga masiva tipo Excel y etiquetas. Al terminar F6:

- se crean, editan, desactivan y (sin historial) borran productos y variantes, con unicidad global de SKU;
- un producto tiene galería de imágenes, opcionalmente asignadas a una variante;
- `GET /products/lookup` resuelve un SKU de variante, un código de barras o un SKU padre, para POS y almacén;
- la carga masiva valida en vivo, valida en el servidor y aplica todo o nada, con existencia opcional;
- se imprimen etiquetas en 50×25 mm, 4×6" y hojas A4 o Carta.

**Alcance (entra):**

1. Contratos de productos, carga masiva y etiquetas en `shared`, más `suggestVariantSku` (F1 lo dejó para F6).
2. Endpoints de catálogo, imágenes, lookup, carga masiva y etiquetas.
3. UI: lista, formulario con generador de matriz y galería, editor masivo y etiquetas.

**Fuera de alcance:** ver la cabecera. Antes de F7 solo existen el rack de staging del seed y los racks del seed de demo, así que la columna `ubicación` de la carga masiva normalmente queda vacía (→ staging) hasta que F7 cree la estructura.

---

## 2. Modelo de datos afectado

Sin cambios de schema. Usa `Category`, `Brand`, `Product`, `ProductVariant`, `ProductImage` (F1 §4.4), y lee `StockLocation`, `Rack`, `Zone`, `Warehouse`, `InventoryMovement`, `CartItem` y `SaleItem` (F1 §4.5–4.6). Escribe stock solo a través de `InventoryService.receive` (F2).

| Concepto | Regla en F6 |
|---|---|
| Producto `SIMPLE` | Tiene exactamente 1 variante "por defecto", con `sku = product.sku` y atributos nulos. La administra el servidor; su `barcode` se captura en el producto. |
| Producto `VARIABLE` | Tiene ≥ 1 variante; cada una con ≥ 1 atributo (talla, color o material) y SKU distinto del SKU padre. |
| Unicidad de SKU | Un SKU de variante no puede ser el SKU padre de **otro** producto, ni un SKU padre el SKU de una variante de otro producto (plan §4.2). Además de los uniques de F1. |
| Atributos | Se recortan espacios y se comparan sin distinguir mayúsculas: `Negro` y `negro` en el mismo producto son la misma combinación. |
| Historial | Una variante tiene historial si existe algún `InventoryMovement`, `CartItem` o `SaleItem` que la referencie. Un producto tiene historial si alguna de sus variantes lo tiene. |
| Precio efectivo | `variant.priceOverride ?? product.price`. |
| Imagen principal | La de menor `sortOrder` del producto. Una variante usa sus imágenes propias; si no tiene, las del producto (plan §13.7). |
| Categoría | Se identifica por su ruta (`Calzado > Dama`, hasta 3 niveles). |
| Stock mostrado | Suma de `quantity` y `reservedQty` de las ubicaciones en almacenes de la sucursal actual (`request.branchId`). `available = quantity − reservedQty`. |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulo | `apps/api/src/modules/products/` con `products.routes.ts`, `images.routes.ts`, `import.routes.ts`, `labels.routes.ts`, `products.service.ts`, `import.service.ts`, `xlsx.ts` (plantilla y lectura con `exceljs`), `catalogs.ts` (categorías y marcas) y `products.repository.ts`. Tag de Swagger `products`. |
| `PUT` de producto | Reemplaza el conjunto de variantes. Las del payload se actualizan por `id` (o se crean si no traen `id`). Una variante existente que no viene en el payload se **borra** si no tiene historial; si tiene → 409 `VARIANT_HAS_HISTORY` (hay que desactivarla) y no se escribe nada. |
| Cambio de tipo | `SIMPLE` ↔ `VARIABLE` solo sin historial: la variante por defecto se reemplaza por las nuevas (o al revés). Con historial → 409 `PRODUCT_TYPE_LOCKED`. |
| Categoría y marca en el formulario | El input lleva `category` (ruta) y `brand` (nombre), no ids. El servidor busca sin distinguir mayúsculas y, si no existe, la crea (misma regla que la carga masiva). |
| Borrado | `DELETE /products/:id` solo sin historial; borra el producto, sus variantes y sus filas de imagen (los archivos quedan). Con historial → 409 `PRODUCT_HAS_HISTORY`. |
| Desactivar | Producto y variante por separado, idempotentes. Una variante se considera activa si ella **y** su producto lo están. |
| Imágenes | `POST /products/:id/images` recibe `{ url, thumbUrl, variantId? }` de una subida previa a `/uploads/product-images` (F2). `url` debe ser `/uploads/product/<uuid>.webp` y `thumbUrl` `/uploads/product/<mismo uuid>.thumb.webp`. Máximo 10 por producto → 409 `PRODUCT_IMAGE_LIMIT`. Se agregan al final (`sortOrder` = máximo + 1). |
| Lookup | `GET /products/lookup?code=` normaliza con `normalizeSku` y busca, en este orden: SKU de variante, `barcode` de variante, SKU padre. Devuelve también variantes o productos inactivos, con sus banderas; cada módulo decide. No encontrado → 404 `NOT_FOUND`. |
| Carga masiva: dónde se lee el `.xlsx` | En el servidor (`POST /products/import/parse`), con `exceljs`, para no cargar esa librería en el bundle web. La plantilla también se genera en el servidor. |
| Carga masiva: validación | Dos niveles. (1) **Celdas y filas** en `shared/productImport.ts` (`validateImportRows`), que corre en el navegador en vivo y otra vez en el servidor. (2) **Contra la BD** solo en el servidor: SKU tomados, ubicaciones, tipos, historial, permisos y capacidad. |
| Carga masiva: aplicar | `POST /products/import/commit` vuelve a validar todo dentro de **una sola transacción** y aplica todo o nada. Con errores → 400 `IMPORT_INVALID`. |
| Existencia | Siempre suma. Por cada fila con existencia, `InventoryService.receive` con tipo `INITIAL_LOAD` si la variante no tenía movimientos antes de la carga, o `PUTAWAY` si ya tenía. `note: 'Carga masiva'`, sin `reference`. Si hay unidades que se suman a variantes con stock y no llega `confirmStockAddition: true` → 409 `IMPORT_CONFIRMATION_REQUIRED` con el resumen. |
| Ubicación de la existencia | `ubicación` se interpreta con `parseLocationCode` (tolerante, F1) en el almacén activo de la sucursal actual (el MVP tiene uno). Vacía → el rack de staging de ese almacén (plan §4.3). Rack inexistente o inactivo → error en la celda. |
| Permisos de la existencia | Una fila con existencia exige `inventory.putaway` además de `products.import`; sin él → error en la celda `existencia`. Si la existencia del archivo más la ocupación actual excede la capacidad de un rack (sin contar staging) → error en las filas de ese rack, salvo `allowCapacityOverride: true` **y** `inventory.override_capacity`; en ese caso el movimiento queda con `capacityOverridden`. |
| Celdas | Al **crear**, los campos obligatorios deben venir. Al **actualizar**, una celda vacía no cambia el valor y `-` borra un valor opcional (`costo`, `categoría`, `marca`, `talla`, `color`, `material`, `precio_variante`); `-` en un campo obligatorio es error. |
| Filas de un mismo producto | Las filas con el mismo `sku_padre` forman un producto. Sus columnas de producto (`nombre`, `categoría`, `marca`, `tipo`, `precio`, `costo`, `activo`) no vacías deben coincidir; si una fila contradice a otra anterior → error en esa celda. Un `simple` tiene una sola fila. |
| Límites | `.xlsx` de hasta 5 MiB y 2 000 filas de datos; etiquetas: hasta 1 000 por solicitud. |
| Editor masivo | `react-data-grid` (MIT). AG Grid Community no incluye el portapapeles por rangos, así que el pegado se implementa con un manejador propio: el texto del portapapeles (TSV de Excel) se reparte desde la celda seleccionada y agrega filas si hace falta. Solo en escritorio (≥ `md`); en móvil: "Usa una computadora para la carga masiva". |
| "Aplicar" | Habilitado solo después de "Validar en servidor" sin errores y sin ediciones posteriores. Muestra el resumen y, si aplica, las casillas "Confirmo sumar N unidades a M variantes que ya tienen stock" y "Permitir exceder capacidad" (esta solo con `inventory.override_capacity`). |
| SKU sugerido | `suggestVariantSku(parentSku, { size, color, material })` en `shared/sku.ts`: `{PADRE}[-{TALLA}][-{COLOR3}][-{MATERIAL3}]`. Talla: mayúsculas, solo `[A-Z0-9]` (`25.5` → `255`). Color y material: sin acentos, mayúsculas, primeras 3 letras (`Café` → `CAF`). Sin atributos o con más de 40 caracteres → `null` (el usuario lo escribe). |
| Etiquetas | `POST /products/labels` devuelve los datos; el dibujo es del cliente. Formatos: **50×25 mm** sin imagen, con nombre, variante, precio opcional y **QR del SKU** (`QrCode` de F3, sin prefijo: `classifyScan` lo lee como producto) más el SKU en texto; **4×6"** con imagen, nombre, variante, precio opcional y **Code128** grande (`Barcode` de F3); **hoja A4 o Carta de 3×8** (24 por hoja) con imagen pequeña, nombre, variante, precio opcional y Code128. Cada variante se repite según su cantidad. |
| Audit | `product.import` (resumen de la carga) y `product.delete` (SKU y nombre). El resto del catálogo no se audita (plan §4.2 limita el audit a acciones sensibles). |
| Consultas web | TanStack Query: `['products', query]`, `['product', id]`, `['product-catalogs']`; las mutaciones invalidan `products`, `product` y, si crean categorías o marcas, `product-catalogs`. |
| Dinero en la UI | Los precios se capturan en pesos (`parseMoney`, F1) y viajan en centavos. |

---

## 4. Dependencias autorizadas (lista cerrada)

| Paquete | Dependencias |
|---|---|
| `apps/api` | `exceljs` |
| `apps/web` | `react-data-grid` |

Cualquier otra se pregunta (P2).

---

## 5. Contratos en `packages/shared`

### 5.1 `sku.ts` (se amplía)

```ts
export function suggestVariantSku(
  parentSku: string,
  attrs: { size?: string | null; color?: string | null; material?: string | null },
): string | null;
```

### 5.2 `products.ts` (nuevo)

```ts
export const CategoryPath = z.string().trim()
  .transform((v) => v.split('>').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(60)).min(1).max(3))
  .transform((parts) => parts.join(' > '));

const Attr = z.string().trim().max(40).transform((v) => (v === '' ? null : v)).nullable();

export const VariantInput = z.object({
  id: Uuid.optional(),
  sku: SkuSchema,
  barcode: SkuSchema.nullable().default(null),
  size: Attr.default(null), color: Attr.default(null), material: Attr.default(null),
  priceOverride: MoneyCents.nullable().default(null),
});

export const ProductUpsertInput = z.object({
  sku: SkuSchema,
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  category: CategoryPath.nullable().default(null),
  brand: z.string().trim().min(1).max(60).nullable().default(null),
  type: ProductType,
  price: MoneyCents,
  cost: MoneyCents.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  barcode: SkuSchema.nullable().default(null),          // solo SIMPLE
  variants: z.array(VariantInput).default([]),          // solo VARIABLE
}).superRefine(/* reglas de §2: SIMPLE sin variants; VARIABLE ≥ 1, cada una con ≥ 1 atributo,
                  SKU ≠ SKU padre, SKUs y combinaciones (sin mayúsculas) sin repetir;
                  barcode solo en SIMPLE; errores con path variants[i].campo */);

export const ProductListQuery = PaginationQuery.extend({
  categoryId: Uuid.optional(),
  brandId: Uuid.optional(),
  type: ProductType.optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: sortQuery(['name', 'sku', 'createdAt']),         // default: name:asc
});

export const StockSummary = z.object({ quantity: NonNegativeInt, reservedQty: NonNegativeInt, available: NonNegativeInt });
const CategoryRef = z.object({ id: Uuid, path: z.string() });
const BrandRef = z.object({ id: Uuid, name: z.string() });

export const ProductListItemDto = ProductDto.extend({
  category: CategoryRef.nullable(), brand: BrandRef.nullable(),
  thumbUrl: z.string().nullable(), variantCount: NonNegativeInt, totalStock: NonNegativeInt,
});
export const VariantDetailDto = ProductVariantDto.extend({
  effectivePrice: MoneyCents, stock: StockSummary, hasHistory: z.boolean(),
  isEffectivelyActive: z.boolean(), thumbUrl: z.string().nullable(),
});
export const ProductDetailDto = ProductListItemDto.extend({
  hasHistory: z.boolean(), variants: z.array(VariantDetailDto), images: z.array(ProductImageDto),
});
export const LookupResultDto = z.discriminatedUnion('match', [
  z.object({ match: z.literal('variant'), product: ProductListItemDto, variant: VariantDetailDto }),
  z.object({ match: z.literal('product'), product: ProductListItemDto, variants: z.array(VariantDetailDto) }),
]);
export const ProductCatalogsDto = z.object({ categories: z.array(CategoryRef), brands: z.array(BrandRef) });

export const ProductImageAddInput = z.object({ url: z.string(), thumbUrl: z.string(), variantId: Uuid.nullable().default(null) });
export const ProductImageOrderInput = z.object({ imageIds: z.array(Uuid).min(1).max(10) });
export const ProductImageAssignInput = z.object({ variantId: Uuid.nullable() });

export const LabelRequest = z.object({
  items: z.array(z.object({ variantId: Uuid, quantity: z.number().int().min(1).max(500) })).min(1),
}).refine((v) => v.items.reduce((s, i) => s + i.quantity, 0) <= 1000, 'Máximo 1 000 etiquetas por solicitud');
export const LabelDataDto = z.object({
  variantId: Uuid, quantity: Quantity, sku: z.string(), productName: z.string(),
  variantLabel: z.string().nullable(),            // "25 · Negro · Piel"
  price: MoneyCents, thumbUrl: z.string().nullable(),
});
```

### 5.3 `productImport.ts` (nuevo)

```ts
export const IMPORT_COLUMNS = [
  'sku_padre', 'nombre', 'categoría', 'marca', 'tipo', 'precio', 'costo', 'sku_variante',
  'talla', 'color', 'material', 'precio_variante', 'existencia', 'ubicación', 'activo',
] as const;
export const IMPORT_MAX_ROWS = 2000;
export const CLEAR_TOKEN = '-';

export const ImportRow = z.object({
  rowNumber: z.number().int().min(2),                      // fila del Excel (1 = encabezado)
  cells: z.record(z.enum(IMPORT_COLUMNS), z.string()),     // texto crudo
});
export const ImportIssue = z.object({ rowNumber: z.number().int(), field: z.enum(IMPORT_COLUMNS).nullable(), message: z.string() });

export function validateImportRows(rows: ImportRow[]): ImportIssue[];  // celdas + reglas entre filas (§3)

export const ImportValidateInput = z.object({
  rows: z.array(ImportRow).min(1).max(IMPORT_MAX_ROWS),
  allowCapacityOverride: z.boolean().default(false),
});
export const ImportCommitInput = ImportValidateInput.extend({ confirmStockAddition: z.boolean().default(false) });

export const ImportSummary = z.object({
  productsToCreate: NonNegativeInt, productsToUpdate: NonNegativeInt,
  variantsToCreate: NonNegativeInt, variantsToUpdate: NonNegativeInt,
  categoriesToCreate: z.array(z.string()), brandsToCreate: z.array(z.string()),
  stock: z.object({
    units: NonNegativeInt, rows: NonNegativeInt, unitsToStaging: NonNegativeInt,
    addingToExisting: z.object({ units: NonNegativeInt, variants: NonNegativeInt }),
  }),
});
export const ImportValidationDto = z.object({ issues: z.array(ImportIssue), summary: ImportSummary });
export const ImportParseDto = z.object({ rows: z.array(ImportRow) });
```

**Reglas de celda** (en `validateImportRows`):

| Columna | Regla |
|---|---|
| `sku_padre` | Obligatoria; `SkuSchema`. |
| `nombre` | Obligatoria al crear; ≤ 200. |
| `categoría` | `CategoryPath`. |
| `marca` | ≤ 60. |
| `tipo` | `simple` o `variable` (sin distinguir mayúsculas); obligatoria al crear. |
| `precio`, `costo`, `precio_variante` | `parseMoney` (pesos, p. ej. `899.00` o `$1,299.50`); `precio` obligatorio al crear. |
| `sku_variante` | En `simple`: vacía o igual a `sku_padre`. En `variable`: obligatoria, `SkuSchema` y distinta de `sku_padre`; no se repite en el archivo. |
| `talla`, `color`, `material` | ≤ 40; una variante nueva de un `variable` necesita al menos uno. |
| `existencia` | Vacía o `0` = sin existencia; si no, entero 1–100 000. |
| `ubicación` | Vacía o `parseLocationCode` válido; sin existencia se ignora. |
| `activo` | `sí`, `si`, `no`, `1`, `0`, `true` o `false`; vacía = no cambia (al crear, sí). |

Como "crear" o "actualizar" depende de la BD, en el navegador las reglas de obligatoriedad se evalúan suponiendo que el producto es nuevo **solo** si ninguna fila del archivo lo referencia como existente; el servidor tiene la última palabra.

### 5.4 `errors.ts`

`ErrorCode` agrega (en la API, con estos estados y mensajes):

| Código | HTTP | Mensaje |
|---|---|---|
| `SKU_TAKEN` | 409 | "Ese SKU ya está en uso." (`details: { sku, field }`) |
| `PRODUCT_HAS_HISTORY` | 409 | "El producto tiene movimientos o ventas; desactívalo en su lugar." |
| `VARIANT_HAS_HISTORY` | 409 | "La variante tiene movimientos o ventas; desactívala en su lugar." (`details: { variantId, sku }`) |
| `PRODUCT_TYPE_LOCKED` | 409 | "No se puede cambiar el tipo de un producto con movimientos o ventas." |
| `PRODUCT_IMAGE_LIMIT` | 409 | "El producto ya tiene el máximo de 10 imágenes." |
| `IMPORT_INVALID` | 400 | "La carga tiene errores." (`details: ImportIssue[]`) |
| `IMPORT_CONFIRMATION_REQUIRED` | 409 | "Confirma que se sumará existencia a variantes que ya tienen stock." (`details: ImportSummary`) |

---

## 6. Endpoints

Todos bajo `/api/v1/products`, con tag `products`. Las respuestas de error son `ApiErrorDto`.

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /` | `products.read`, `branchScoped` | `ProductListQuery` | 200 `paginated(ProductListItemDto)` |
| `GET /catalogs` | `products.read` | — | 200 `ProductCatalogsDto` |
| `GET /lookup` | `products.read`, `branchScoped` | query `code` (1–60) | 200 `LookupResultDto` · 404 |
| `GET /:id` | `products.read`, `branchScoped` | — | 200 `ProductDetailDto` · 404 |
| `POST /` | `products.manage` | `ProductUpsertInput` | 201 `ProductDetailDto` · 400 · 409 `SKU_TAKEN` |
| `PUT /:id` | `products.manage` | `ProductUpsertInput` | 200 `ProductDetailDto` · 400 · 404 · 409 (`SKU_TAKEN`, `VARIANT_HAS_HISTORY`, `PRODUCT_TYPE_LOCKED`) |
| `POST /:id/deactivate`, `/:id/reactivate` | `products.manage` | — | 200 `ProductDetailDto` · 404 |
| `POST /:id/variants/:variantId/deactivate`, `…/reactivate` | `products.manage` | — | 200 `ProductDetailDto` · 404 |
| `DELETE /:id` | `products.manage` | — | 204 · 404 · 409 `PRODUCT_HAS_HISTORY` |
| `POST /:id/images` | `products.manage` | `ProductImageAddInput` | 201 `ProductImageDto` · 400 · 404 · 409 `PRODUCT_IMAGE_LIMIT` |
| `PUT /:id/images/order` | `products.manage` | `ProductImageOrderInput` (exactamente las imágenes del producto) | 200 `ProductImageDto[]` · 400 |
| `PATCH /:id/images/:imageId` | `products.manage` | `ProductImageAssignInput` (variante del mismo producto) | 200 `ProductImageDto` · 400 · 404 |
| `DELETE /:id/images/:imageId` | `products.manage` | — | 204 · 404 |
| `GET /import/template` | `products.import` | — | 200 `.xlsx` |
| `POST /import/parse` | `products.import` | multipart, campo `file` (`.xlsx`, ≤ 5 MiB) | 200 `ImportParseDto` · 400 `IMPORT_INVALID` (encabezados o filas de más) · 413 · 415 |
| `POST /import/validate` | `products.import`, `branchScoped` | `ImportValidateInput` | 200 `ImportValidationDto` (sin escrituras) |
| `POST /import/commit` | `products.import`, `branchScoped` | `ImportCommitInput` | 200 `ImportSummary` · 400 `IMPORT_INVALID` · 409 `IMPORT_CONFIRMATION_REQUIRED` |
| `POST /labels` | `products.labels` | `LabelRequest` | 200 `LabelDataDto[]` · 400 (variante inexistente o inactiva) |

**Plantilla:** hojas `Productos` (los 15 encabezados en orden, con listas desplegables en `tipo` y `activo`), `Instrucciones` (reglas de §5.3, ejemplos y el uso de `-`), `Categorías` (rutas existentes) y `Marcas`. La hoja `Productos` no trae filas de ejemplo, para que no se importen por error.

**Parse:** lee la hoja `Productos` (o la primera); los encabezados se comparan sin distinguir mayúsculas ni acentos y deben ser los 15 de `IMPORT_COLUMNS`; las celdas se convierten a texto (números sin formato, p. ej. `899` → `"899"`); se omiten filas vacías.

---

## 7. Pantallas (wireframe en texto)

**Lista (`/products`)**

```
┌──────────────────────────────┐
│ Productos  [Etiquetas] [+ Nuevo]   ← según permisos
│ [ Escanea o escribe… ] [📷]  │  ← ScanInput: producto → detalle
│ [Activos ▾][Tipo ▾][Categ. ▾]│
│ [Carga masiva]               │  ← products.import (escritorio)
├──────────────────────────────┤
│ [img] ZAP0101                │
│       Zapato de piel dama    │
│       8 variantes · 23 pzas  │
└──────────────────────────────┘
```

Un escaneo de ubicación o de promoción muestra "Este código es de una ubicación / promoción, no de un producto". Un SKU inexistente: "No se encontró el producto".

**Formulario (`/products/new`, `/products/:id`)**

```
  Datos generales
  SKU [ZAP0101__]  Nombre [Zapato de piel dama_____]
  Categoría [Calzado > Dama ▾]  Marca [Demo Calzado ▾]   ← autocompletar o escribir nueva
  Precio $[899.00]  Costo $[450.00]  Etiquetas [chips]
  Descripción [__________________]
  Tipo  ○ Simple  ◉ Variable        ← bloqueado si tiene historial
  (Simple: Código de barras [______])

  Variantes
  Tallas    [23][23.5][24][+]
  Colores   [Negro][Café][+]
  Materiales[+]
  [Generar combinaciones]         ← agrega solo las que faltan
  ┌──────────────────────────────────────────┐
  │ SKU              Talla Color  Precio Act.│
  │ ZAP0101-23-NEG   23    Negro  —      ☑   │
  │ ZAP0101-235-NEG  23.5  Negro  —      ☑   │  ← SKU editable; "—" = precio del producto
  │ …                         [Quitar]       │
  └──────────────────────────────────────────┘

  Imágenes (máx. 10)  [📷 Tomar foto] [Subir archivo]
  [img1 ★][img2][img3]   ← ★ principal; ↑↓ ordenar; asignar a variante; quitar

  [ Guardar ]   [Desactivar]  [Eliminar]   ← Eliminar solo sin historial
```

**Carga masiva (`/products/import`, solo escritorio)**

```
 [Descargar plantilla] [Importar .xlsx] [+ Fila]       [Validar en servidor] [Aplicar]
 ┌────┬─────────┬──────────────┬──────────┬───────┬─────────┬────┬──────┬────────┐
 │ #  │sku_padre│ nombre       │categoría │ tipo  │ precio  │ …  │exist.│ubicación│
 │ 2  │ZAP0101  │Zapato de piel│Calzado > │variable│ 899.00 │    │ 5    │A-01-03 │
 │ 3  │ZAP0101  │              │          │       │         │    │ 3    │        │
 │ 4  │BOL0201  │Bolso tote    │Bolsos    │otro ⚠ │ abc ⚠   │    │      │        │  ← celdas con error
 └────┴─────────┴──────────────┴──────────┴───────┴─────────┴────┴──────┴────────┘
 2 errores en vivo · 0 errores del servidor

 Resumen (tras validar en servidor):
  Productos: 3 nuevos, 1 actualizado · Variantes: 9 nuevas
  Se crearán: categoría "Calzado > Dama", marca "Demo Bolsos"
  Existencia: 20 unidades (8 a staging)
  ☐ Confirmo sumar 6 unidades a 2 variantes que ya tienen stock
  ☐ Permitir exceder capacidad          ← solo con inventory.override_capacity
```

**Etiquetas (`/products/labels`)**

```
  [ Escanea o busca una variante ]
  ZAP0101-25-NEG  Zapato… 25 Negro   Cant. [3]  [✕]
  BOL0201-ROJ     Bolso tote Rojo    Cant. [1]  [✕]
  Formato [50×25 mm ▾]  ☐ Mostrar precio
  ┌─────────────┐
  │ ▓▓ Zapato de│   ← 50×25: QR + texto, sin imagen
  │ ▓▓ piel dama│
  │ 25 · Negro  │
  │ ZAP0101-25-NEG
  └─────────────┘
  [ Imprimir ]
```

---

## 8. Reglas y casos borde

1. **SKU duplicado** (producto, variante o cruzado con otro producto): 409 `SKU_TAKEN` con `sku` y `field`; en la carga masiva, un error en la fila y celda.
2. **Quitar una variante con historial** en el formulario: 409 `VARIANT_HAS_HISTORY`; la UI ofrece desactivarla.
3. **Cambiar el tipo con historial:** 409 `PRODUCT_TYPE_LOCKED`; el selector aparece bloqueado.
4. **Atributos repetidos** (`Negro`/`negro` en la misma talla): error de validación en la variante.
5. **Producto inactivo:** sus variantes aparecen inactivas en el lookup y en las etiquetas no se pueden imprimir.
6. **Reimportar el mismo archivo con existencia:** el stock se suma; el resumen avisa y exige confirmación.
7. **Existencia sin `inventory.putaway`:** error en la celda `existencia`; el resto del archivo se puede aplicar si se quitan esas existencias.
8. **Ubicación inexistente o inactiva:** error en la celda `ubicación`.
9. **Capacidad excedida:** error en las filas del rack, salvo permiso y casilla marcada.
10. **Categoría o marca nueva:** se crea al aplicar (o al guardar el formulario), sin distinguir mayúsculas de las existentes.
11. **Celda vacía al actualizar:** no cambia nada. `-` borra un opcional; en un obligatorio, error.
12. **Cualquier error al aplicar:** no se escribe nada (ni productos, ni categorías, ni stock).
13. **`.xlsx` con encabezados distintos o más de 2 000 filas:** 400 `IMPORT_INVALID` al importarlo.
14. **Imagen 11:** 409 `PRODUCT_IMAGE_LIMIT`; el botón de subir se deshabilita al llegar a 10.
15. **Etiqueta de 50×25 mm:** siempre QR (cualquier largo de SKU cabe); 4×6" y hojas usan Code128.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Contratos.**
  - `suggestVariantSku` en `sku.ts`, `products.ts`, `productImport.ts` y los códigos de error (también en `ERROR_HTTP_STATUS` y `ERROR_MESSAGES` de la API). Tests **T1–T7**.
  - *Verificable:* T1–T7 en verde (incluida la medición de 500 filas).
- [ ] **2. API: catálogo.**
  - `products.repository.ts`, `catalogs.ts`, `products.service.ts` y `products.routes.ts` (lista, catálogos, detalle, alta, edición, desactivar, borrar); registrar en `app.ts`. Tests **T8–T15**.
  - *Verificable:* T8–T15 en verde.
- [ ] **3. API: imágenes y lookup.**
  - `images.routes.ts` y `GET /lookup`. Tests **T16–T17**.
  - *Verificable:* T16–T17 en verde.
- [ ] **4. API: carga masiva.**
  - Instalar `exceljs`; `xlsx.ts`, `import.service.ts` e `import.routes.ts`. Tests **T18–T25**.
  - *Verificable:* T18–T25 en verde.
- [ ] **5. API: etiquetas.**
  - `labels.routes.ts`. Test **T26**.
  - *Verificable:* T26 en verde.
- [ ] **6. UI: lista y escaneo.**
  - `ProductsListPage`, hooks y rutas. Test **T27**.
  - *Verificable:* T27 en verde.
- [ ] **7. UI: formulario.**
  - `ProductFormPage`, `VariantMatrixGenerator`, tabla de variantes y `ProductGallery`. Tests **T28–T30**.
  - *Verificable:* T28–T30 en verde.
- [ ] **8. UI: carga masiva.**
  - Instalar `react-data-grid`; `BulkImportPage`, pegado TSV, validación en vivo, importar, validar y aplicar. Tests **T31–T33**.
  - *Verificable:* T31–T33 en verde.
- [ ] **9. UI: etiquetas.**
  - `LabelsPage` y las 3 plantillas. Tests **T34–T35**.
  - *Verificable:* T34–T35 en verde, y la vista previa de impresión del navegador muestra cada formato.
- [ ] **10. README y cierre.**
  - En el README: alta de productos, plantilla y reglas de la carga masiva, y formatos de etiqueta.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales (§11); registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 35)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (más los datos que cada test crea). Los de `web` usan Jest + RTL con `fetch` simulado. Las imágenes se generan con `sharp` y los `.xlsx`, con `exceljs`, dentro de cada test.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `sku.test.ts` | `suggestVariantSku` (`it.each`): `ZAP0101` + 25.5/Negro → `ZAP0101-255-NEG`; + 23/Café → `ZAP0101-23-CAF`; `BOL0201` + Rojo → `BOL0201-ROJ`; + 25/Negro/Piel → `ZAP0101-25-NEG-PIE`; talla `xl` → `XL`; sin atributos → `null`; más de 40 caracteres → `null`. |
| T2 | `shared` · `products.test.ts` | `ProductUpsertInput`: SIMPLE con `variants` → error; VARIABLE sin variantes → error; variante sin atributos → error en `variants[0]`; combinación repetida (`Negro`/`negro`) → error en `variants[1]`; SKU de variante igual al padre o repetido → error; `barcode` en VARIABLE → error; precio decimal → error; `category: " Calzado >  Dama "` → `"Calzado > Dama"`; 4 niveles → error. |
| T3 | `shared` · `products.test.ts` | `ProductListQuery`: coerción de `isActive` y `type`; `sort` acepta `name:asc` y rechaza `price:asc`. `LabelRequest`: 1 001 etiquetas en total → error. |
| T4 | `shared` · `productImport.test.ts` | Reglas de celda (`it.each`): `tipo` `Variable` válido y `otro` error; `precio` `$1,299.50` válido y `abc` error; `existencia` `0` = sin existencia, `-1` y `1.5` error; `activo` `Sí`/`no`/`1` válidos y `quizá` error; `ubicación` `a-1-3` válida y `ZZZ` error; `-` en `costo` válido y en `sku_padre` error. Cada error trae `rowNumber` y `field`. |
| T5 | `shared` · `productImport.test.ts` | Reglas entre filas: `nombre` distinto en dos filas del mismo `sku_padre` → error en la segunda; `sku_variante` repetido → error; `simple` con 2 filas → error; fila `variable` sin `sku_variante` → error. |
| T6 | `shared` · `productImport.test.ts` | `validateImportRows` sobre 500 filas generadas (100 productos × 5 variantes) termina en < 3 000 ms y sin errores. |
| T7 | `shared` · `errors.test.ts` + `products.test.ts` | Los 7 códigos nuevos existen en `ErrorCode`. Las fixtures de `ProductDetailDto`, `LookupResultDto` (ambas ramas), `ImportValidationDto` y `LabelDataDto` son válidas. |
| T8 | `int` · `products-crud.int.test.ts` | `POST` VARIABLE con 4 variantes → 201 `ProductDetailDto` con `effectivePrice` correcto. `POST` SIMPLE con `barcode` → una variante con `sku` = SKU padre, atributos nulos y ese `barcode`. Categoría y marca nuevas se crean; existentes (otra capitalización) se reutilizan. Un SELLER → 403. |
| T9 | `int` · `products-crud.int.test.ts` | `SKU_TAKEN` (`it.each`): SKU padre repetido; SKU de variante igual al SKU padre de otro producto; SKU padre igual a una variante de otro producto. Cada uno con `details.sku` y `details.field`, sin escrituras. `barcode` repetido → 409. |
| T10 | `int` · `products-crud.int.test.ts` | `PUT`: cambia datos, agrega una variante, modifica otra por `id` y borra la omitida sin historial. Con una variante con historial (movimiento creado con `InventoryService.receive`) omitida → 409 `VARIANT_HAS_HISTORY` y nada cambia. |
| T11 | `int` · `products-crud.int.test.ts` | Cambio de tipo SIMPLE → VARIABLE sin historial → OK (la variante por defecto desaparece). Con historial → 409 `PRODUCT_TYPE_LOCKED`. |
| T12 | `int` · `products-crud.int.test.ts` | Desactivar y reactivar producto y variante son idempotentes; con el producto inactivo, sus variantes tienen `isEffectivelyActive: false`. |
| T13 | `int` · `products-crud.int.test.ts` | `DELETE` sin historial → 204 y no quedan producto, variantes ni filas de imagen; con historial → 409 `PRODUCT_HAS_HISTORY`; un `AuditLog` `product.delete` en el primer caso. |
| T14 | `int` · `products-read.int.test.ts` | `GET /products`: `q` encuentra por SKU padre, SKU de variante, nombre y marca (sin mayúsculas); filtros `categoryId`, `type` e `isActive`; paginación; cada item trae `thumbUrl` de la imagen principal, `variantCount` y `totalStock`. `GET /catalogs` devuelve rutas y marcas. |
| T15 | `int` · `products-read.int.test.ts` | `GET /:id`: stock por variante (`quantity`, `reservedQty`, `available`) solo de la sucursal actual (otra sucursal con stock en el test no suma); `hasHistory`; imágenes en orden; `thumbUrl` de la variante usa su imagen propia o la del producto. Inexistente → 404. |
| T16 | `int` · `products-images.int.test.ts` | Agregar una imagen subida con `/uploads/product-images` → 201 al final del orden; `url` de sucursal o `thumbUrl` de otro uuid → 400; la 11.ª → 409 `PRODUCT_IMAGE_LIMIT`; reordenar con el conjunto exacto → OK y con uno incompleto → 400; asignar a una variante de otro producto → 400; quitar → 204 y la principal cambia. |
| T17 | `int` · `products-lookup.int.test.ts` | `code` `zap0101-25-neg` → `match: 'variant'`; por `barcode` → `variant`; `ZAP0101` → `match: 'product'` con sus variantes; desconocido → 404; una variante inactiva vuelve con `isEffectivelyActive: false`. |
| T18 | `int` · `products-import.int.test.ts` | `GET /import/template` → `.xlsx` con las hojas `Productos` (15 encabezados en orden, sin filas), `Instrucciones`, `Categorías` (incluye `Calzado`) y `Marcas`. Sin `products.import` → 403. |
| T19 | `int` · `products-import.int.test.ts` | `POST /import/parse`: un `.xlsx` con 3 filas y números → `rows` con `rowNumber` 2–4 y celdas como texto (`899` → `"899"`); encabezados alterados → 400 `IMPORT_INVALID`; 2 001 filas → 400; un `.csv` → 415; más de 5 MiB → 413. |
| T20 | `int` · `products-import.int.test.ts` | `validate` no escribe nada y reporta: SKU de variante igual a un SKU padre existente (`SKU_TAKEN` en esa celda), ubicación inexistente, `tipo` distinto del producto existente con historial; y el resumen con creados/actualizados, `categoriesToCreate` (`Calzado > Dama`) y `brandsToCreate`. |
| T21 | `int` · `products-import.int.test.ts` | `commit` de 2 productos nuevos (un simple y un variable con 3 variantes), con existencia a `A-01-01` (seed de demo) y a staging (ubicación vacía) → productos, categorías y marcas creados; `stock_location` con las cantidades; movimientos `INITIAL_LOAD` con `note: 'Carga masiva'`; `AuditLog` `product.import` con el resumen. |
| T22 | `int` · `products-import.int.test.ts` | Actualizar: una fila con solo `sku_padre`, `sku_variante` y `precio_variante` cambia ese precio y nada más; `-` en `costo` lo deja en `null`; `-` en `nombre` → `IMPORT_INVALID`. |
| T23 | `int` · `products-import.int.test.ts` | Variante con stock previo + fila con existencia: `commit` sin `confirmStockAddition` → 409 `IMPORT_CONFIRMATION_REQUIRED` con `addingToExisting` y sin escrituras; con la confirmación → movimiento `PUTAWAY` y la cantidad sumada. |
| T24 | `int` · `products-import.int.test.ts` | Un archivo con 10 filas donde la 9 choca con un SKU existente → 400 `IMPORT_INVALID` en esa fila; no se crea ningún producto, categoría, marca ni stock. |
| T25 | `int` · `products-import.int.test.ts` | Usuario con `products.import` sin `inventory.putaway`: las filas con existencia dan error en `existencia` y las demás no. Rack con capacidad 40 y 38 ocupadas + existencia 5 → error de capacidad; con `allowCapacityOverride` y `inventory.override_capacity` → OK con `capacityOverridden: true`; con la casilla pero sin el permiso → error. |
| T26 | `int` · `products-labels.int.test.ts` | `POST /labels` → un `LabelDataDto` por variante con `quantity`, precio efectivo, `variantLabel` (`"25 · Negro"`) y `thumbUrl` (de la variante, del producto o `null`); variante inactiva → 400; sin `products.labels` → 403. |
| T27 | `web` · `ProductsListPage.test.tsx` | Lista los productos del API simulado; la búsqueda envía `q`; un escaneo de producto llama a `lookup` y navega al detalle; uno de ubicación o promoción muestra su aviso sin llamar a `lookup`; "Nuevo" solo con `products.manage` y "Carga masiva" solo con `products.import`. |
| T28 | `web` · `VariantMatrixGenerator.test.tsx` | Tallas `23` y `23.5` × colores `Negro` y `Café` → 4 filas con SKU `ZAP0101-23-NEG`, `ZAP0101-235-CAF`, etc.; un SKU editado a mano se conserva; "Generar combinaciones" otra vez no duplica filas existentes. |
| T29 | `web` · `ProductFormPage.test.tsx` | SIMPLE muestra "Código de barras" y oculta las variantes; VARIABLE muestra el generador; los precios en pesos se envían en centavos; un 409 `SKU_TAKEN` marca el campo indicado por `details.field`; con `hasHistory` el tipo está bloqueado y "Eliminar" no aparece; un 409 `VARIANT_HAS_HISTORY` ofrece "Desactivar variante". |
| T30 | `web` · `ProductGallery.test.tsx` | Subir llama a `/uploads/product-images` (con `FormData`) y luego a `POST /products/:id/images`; mover arriba/abajo llama a `PUT …/images/order`; asignar a una variante; quitar con confirmación; con 10 imágenes, subir queda deshabilitado. |
| T31 | `web` · `BulkImportPage.test.tsx` | Con `matchMedia` < 768 px muestra "Usa una computadora para la carga masiva"; ≥ 768 px muestra el grid. "Importar .xlsx" envía el archivo a `parse` y carga sus filas. |
| T32 | `web` · `BulkImportPage.test.tsx` | Pegar un TSV de 3 filas × 4 columnas en una celda reparte los valores y agrega las filas que faltan; una celda inválida se resalta con su mensaje al momento; `categoría` y `marca` autocompletan desde `catalogs`. |
| T33 | `web` · `BulkImportPage.test.tsx` | "Aplicar" está deshabilitado hasta validar en el servidor sin errores y vuelve a deshabilitarse al editar una celda; los errores del servidor se muestran en su celda; con `addingToExisting` la casilla de confirmación es obligatoria; "Permitir exceder capacidad" solo aparece con `inventory.override_capacity`; el éxito muestra el resumen. |
| T34 | `web` · `LabelsPage.test.tsx` | Agregar variantes por escaneo y por búsqueda; cantidad 3 → 3 etiquetas en la vista previa; "Mostrar precio" agrega el precio; "Imprimir" monta `PrintLayout` con el tamaño del formato y llama a `window.print`. |
| T35 | `web` · `LabelsPage.test.tsx` | `it.each` de formatos: 50×25 → `QrCode` con el SKU sin prefijo, el SKU en texto y sin imagen; 4×6 → imagen y `Barcode`; A4 y Carta → 24 etiquetas por hoja (25 etiquetas → 2 hojas), con imagen y `Barcode`. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F5 siguen en verde.

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | No se pueden crear SKUs duplicados (tampoco cruzados entre producto y variante); el error indica la fila y el SKU. | T9, T20, T24 |
| CA2 | Una carga de 500 filas se valida en menos de 3 s en el cliente y se aplica de forma atómica. | T6, T24 |
| CA3 | La existencia de la carga masiva se suma, con el tipo de movimiento correcto, solo con permiso y con confirmación cuando hay stock previo. | T21, T23, T25 |
| CA4 | Productos con variantes, imágenes y desactivación funcionan en móvil y escritorio; el borrado solo procede sin historial. | T8–T13, T29, T30 + verificación manual |
| CA5 | El lookup resuelve SKU de variante, código de barras y SKU padre. | T17 |
| CA6 | Las etiquetas impresas en la Ribetec RT-420ME (50×25 con QR y 4×6 con Code128) y en hoja A4 o Carta se leen con la cámara del sistema y con el lector. | T35 + verificación manual (fecha, dispositivo y responsable en §12) |
| CA7 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F5. | Salida de los comandos en §12 |
| CA8 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-03 | La existencia de la carga masiva siempre suma: `INITIAL_LOAD` si la variante no tenía movimientos y `PUTAWAY` si ya tenía; si se suma a stock previo, hay que confirmarlo. | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | Al actualizar, celda vacía = no cambiar y `-` = borrar un opcional. | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | Categorías y marcas desconocidas se crean con aviso; subcategorías con `>`. | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | Aplicar la carga es todo o nada, después de validar en el servidor sin errores. | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | La existencia exige `products.import` + `inventory.putaway`; exceder la capacidad, además `inventory.override_capacity` y la casilla. | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | Etiqueta de 50×25 mm sin imagen y con QR del SKU (un Code128 legible no cabe); 4×6" y hojas con imagen y Code128. | Usuario (chat); plan §5.3, §7.2 y §8 F6 actualizados |
| 2026-10-03 | En el SKU sugerido, las tallas con medio número pierden el punto (`25.5` → `255`). | Usuario (chat); plan §8 F6 actualizado |
| 2026-10-03 | El `.xlsx` se lee y la plantilla se genera en el servidor (`exceljs` solo en `api`); se agrega `POST /import/parse`. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Editor masivo con `react-data-grid` y pegado TSV propio; solo en escritorio. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | `PUT` reemplaza el conjunto de variantes: la omitida se borra sin historial o da 409 con historial. Cambio de tipo solo sin historial. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | El formulario recibe categoría (ruta) y marca (nombre) y el servidor las crea si no existen, igual que la carga masiva; `GET /catalogs` para autocompletar. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Las columnas de producto deben coincidir entre las filas de un mismo `sku_padre`; límites de 2 000 filas, 5 MiB, 10 imágenes y 1 000 etiquetas. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Hoja de etiquetas A4 o Carta de 3×8 (24 por hoja). | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Stock mostrado por sucursal actual (`branchScoped`); el lookup devuelve también inactivos con sus banderas. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Audit solo de `product.import` y `product.delete`. 7 códigos de error nuevos. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
