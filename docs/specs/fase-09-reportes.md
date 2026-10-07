---
id: fase-09
titulo: Reportes de ventas
estado: LISTA
depende_de: [fase-08]
autoriza_codigo_en:
  - "apps/api/src/modules/reports/**"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/core/errors.test.ts"
  - "apps/api/src/app.ts"
  - "apps/api/test/integration/reports-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/reports.ts"
  - "packages/shared/src/reports.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "apps/web/src/features/reports/**"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Reportes de inventario, de kardex, de ajustes por motivo o de productos más vendidos"
  - "Gráficas y comparativos entre periodos"
  - "Comisiones por vendedor"
  - "Reportes consolidados de varias sucursales; el reporte es siempre de la sucursal actual"
  - "Cancelar ventas desde reportes (solo en el historial de caja, F8, mientras la caja siga abierta)"
  - "Cambios en el POS (F8), en SaleTicket o en el cálculo de totales (computeSaleTotals)"
  - "Exportar a CSV o PDF; envío por correo o programado"
  - "Cambios a schema.prisma o migraciones fuera del índice declarado en F1 (§2)"
tests_requeridos_total: 22
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/reports/**, apps/web/src/features/reports/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 9: Reportes de ventas

## 1. Contexto y alcance

Referencias: plan §1.2 (Reportes), §3 (convenciones: dinero, paginación), §4.2 (`Sale`, `SaleItem`, `Payment`, `CashRegister`), §6.2 (`reports.sales`, `reports.sales.all_users`), §8 Fase 9, §9 (pruebas), §12 (rendimiento) y §13.8 (volumen, pendiente). Se apoya en F1 (modelo, `PaginationQuery`, `paginated`, `MoneyCents`, `formatMoney`), F2 (acceso por ruta, `branchContext`), F3 (`apiFetch`, guards, `DataTable`, estados, `PrintLayout`, `usePrint`, `formatDate`/`formatDateTime`), F5 (`Branch.timezone` define el día; `BranchDto`), F6 (`exceljs` ya instalado en `api`) y F8 (`SaleTicketDto`, `SaleListItemDto`, `PAYMENT_METHOD_LABELS`, el armado del ticket en `sales.service.ts` y el componente `SaleTicket`).

**Objetivo:** consultar las ventas de la sucursal por periodo, con totales y desgloses que cuadran con los cortes de caja. Al terminar F9:

- quien tenga `reports.sales` elige un periodo (con atajos Hoy, Ayer, Últimos 7 días y Este mes) y filtra por caja, vendedor y método de pago;
- ve tarjetas de totales (ventas, unidades, subtotal, descuentos, IVA, total y ticket promedio), desgloses por método, por caja y por vendedor, y una tarjeta aparte con las canceladas;
- recorre la lista de ventas, abre el detalle (el ticket) y lo reimprime;
- exporta el reporte a `.xlsx`;
- sin `reports.sales.all_users`, solo ve las ventas donde fue vendedor (quien atendió) **o** cajero (quien cobró).

**Alcance (entra):**

1. Cambio declarado en F1: índice `Sale[cashierId, createdAt]` (§2).
2. Contratos de reportes en `shared` (`reports.ts`), con `reportPresetRange` para los atajos de fecha.
3. Endpoints de opciones de filtro, resumen, lista, detalle y exportación.
4. UI de Reportes: filtros, tarjetas, desgloses, lista, detalle con reimpresión y exportar.

**Fuera de alcance:** ver la cabecera.

---

## 2. Modelo de datos afectado

**Cambio en F1** (F1 está `LISTA` sin implementar; ya se aplicó en su spec, §4.6, decisión del usuario 2026-10-06):

| Cambio | Detalle |
|---|---|
| `Sale` `@@index([cashierId, createdAt])` | La regla "vendedor o cajero" filtra por `cashierId`; ya existen `[branchId, createdAt]` y `[sellerId, createdAt]`. Lo cubre F1 T16 (sin diferencias entre BD y schema). |

Sin tablas ni campos nuevos. Lee `Sale`, `SaleItem` (solo `quantity`), `Payment`, `CashRegister`, `User` y `Branch` (`code`, `timezone`).

| Concepto | Regla en F9 |
|---|---|
| Periodo | `from` y `to` son fechas locales (`YYYY-MM-DD`, inclusivas) en `Branch.timezone`. Se convierten en SQL: `created_at >= (from::timestamp AT TIME ZONE tz)` y `created_at < ((to + 1)::timestamp AT TIME ZONE tz)`. Por defecto, `from = to =` hoy en la zona de la sucursal. Máximo 366 días. |
| Ventas que cuentan | Solo `COMPLETED`. Una venta cancelada sale de los totales y los desgloses (como en el corte de F8) y se reporta aparte en `cancelled`, por la fecha en que se **cobró**. |
| Visibilidad | Con `reports.sales.all_users`: todas las ventas de la sucursal. Sin él: `sellerId = actor OR cashierId = actor` (decisión del usuario 2026-10-06). Aplica a resumen, desgloses, canceladas, lista, detalle y exportación. |
| Unidades | Σ `SaleItem.quantity` de las ventas que cuentan. |
| Ticket promedio | `round(total ÷ salesCount)` con redondeo a medio hacia arriba en enteros; 0 si no hay ventas. |
| Por método | Σ `Payment.amount` por método (lo cobrado, no lo recibido) y cuántas ventas tienen al menos un pago de ese método. Una venta mixta cuenta en los dos métodos, pero una sola vez en `salesCount`. Σ montos de `byMethod` = `total` (salvo ventas de total 0, que no tienen pagos). |
| Por caja / por vendedor | Agrupan por `cashRegisterId` y por `sellerId` (quien atendió). |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulo | `apps/api/src/modules/reports/` con `reports.routes.ts`, `reports.service.ts`, `reports.repository.ts` (SQL de agregación) y `xlsx.ts` (exportación con `exceljs`). Tag de Swagger `reports`. Todas las rutas son `branchScoped` y requieren `reports.sales`. |
| Agregación | En SQL (`$queryRaw` con parámetros, sin interpolar), una consulta por bloque: totales, `byMethod`, `byRegister`, `bySeller` y canceladas. Los filtros y la visibilidad se aplican igual en todas. No se cargan ventas a memoria para sumar. |
| Filtros | `cashRegisterId`, `sellerId` (quien atendió) y `paymentMethod` (ventas con al menos un pago de ese método). Se intersectan con la visibilidad: sin `all_users`, `sellerId` de otro usuario es válido y devuelve las ventas de ese vendedor que el actor cobró. Una caja de otra sucursal → 403 `BRANCH_FORBIDDEN`. |
| Filtro de estado | `status` (`COMPLETED` o `CANCELLED`) solo aplica a la lista y a la exportación; el resumen siempre separa ambos. |
| Resumen y lista separados | `GET /reports/sales` devuelve el resumen y `GET /reports/sales/list` la lista paginada, para no recalcular los totales al paginar. Se ajusta el plan §8 F9, que los describía en un solo endpoint. |
| Detalle | `GET /reports/sales/:id` con `reports.sales` devuelve el `SaleTicketDto` de F8, armado con la misma función de `pos/sales.service.ts` (se importa, no se modifica), para que un rol sin `pos.sell` también pueda ver y reimprimir. Una venta fuera de su visibilidad → 403 `FORBIDDEN`; de otra sucursal → 403 `BRANCH_FORBIDDEN`. |
| Opciones de filtro | `GET /reports/sales/options`: cajas de la sucursal (también las inactivas, porque pueden tener ventas) y vendedores con al menos una venta en la sucursal (con `all_users`; sin él, solo el actor). |
| Exportación | `GET /reports/sales/export` con los mismos filtros que la lista. Responde `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` con `Content-Disposition: attachment; filename="ventas-{code}-{from}_{to}.xlsx"`. Hojas: **Resumen** (periodo, sucursal, filtros, totales, canceladas y los tres desgloses) y **Ventas** (folio, fecha y hora locales, caja, vendedor, cajero, cliente, estado, unidades, subtotal, descuentos, IVA, total y métodos). El dinero se escribe en pesos (`centavos ÷ 100`) con formato `$#,##0.00`, solo en esta frontera; las fechas, como fecha de Excel en la hora local de la sucursal. Máximo 20 000 ventas (`MAX_EXPORT_ROWS`, inyectable en el servicio para los tests); más → 400 `REPORT_TOO_LARGE`. |
| Rango | `to` anterior a `from` o más de 366 días → 400 `REPORT_RANGE_TOO_LARGE` (el primero, como error de validación en `to`). |
| Atajos de fecha | `reportPresetRange(preset, timeZone, now)` en `shared` devuelve `{ from, to }` en la zona de la sucursal: Hoy, Ayer, Últimos 7 días (hoy y los 6 anteriores) y Este mes (del día 1 a hoy). Lo usa la web; la API solo aplica el default de hoy. |
| Zona horaria | La de `Branch.timezone` al consultar: un cambio en Ajustes reagrupa también las ventas pasadas (F5 §8.4). La UI la muestra junto al periodo ("Hora de America/Mexico_City"). |
| Rendimiento | Criterio del plan: un mes completo responde en menos de 1 s. Con el índice `[branchId, createdAt]` y los de `Payment`/`SaleItem` por `saleId`. El volumen de prueba es **supuesto** (§10, T15) mientras la pregunta §13.8 del plan siga pendiente; si la respuesta del cliente lo supera, se revisa en F10. |
| Rutas web | Guard `reports.sales`. `/reports` (resumen, filtros y lista) y `/reports/sales/:id` (detalle). Los filtros viven en la URL (`useSearchParams`) para que "atrás" desde el detalle conserve el periodo. |
| Consultas web | TanStack Query: `['report-options', branchId]`, `['sales-report', branchId, filtros]`, `['sales-report-list', branchId, filtros, page]` y `['sale-ticket', id]`. |
| Descarga | La web pide la exportación con `apiFetch` (respuesta como `blob`, con el token como cualquier llamada) y la guarda con un enlace temporal (`URL.createObjectURL`) usando el nombre de `Content-Disposition`. |
| Reimpresión | Usa `SaleTicket` de F8 dentro de `PrintLayout` con el ancho del dispositivo (`wm.pos.ticketWidth`, 80 mm si no hay; acceso a `localStorage` en `try/catch`) y `usePrint()`. |

---

## 4. Dependencias autorizadas (lista cerrada)

Ninguna nueva (`exceljs` ya está en `apps/api` desde F6).

---

## 5. Contratos en `packages/shared`

### 5.1 `reports.ts` (nuevo)

```ts
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida');   // F7 la define sin exportar en inventory.ts; no se toca
export const MAX_REPORT_DAYS = 366;
export const MAX_EXPORT_ROWS = 20_000;
export const ReportPreset = z.enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'THIS_MONTH']);
export const REPORT_PRESET_LABELS: Record<ReportPreset, string>;   // Hoy, Ayer, Últimos 7 días, Este mes
export function reportPresetRange(preset: ReportPreset, timeZone: string, now: Date): { from: string; to: string };
export function daysInRange(from: string, to: string): number;      // inclusivo; ('2026-10-01', '2026-10-31') → 31

export const SalesReportQuery = z.object({
  from: LocalDate.optional(), to: LocalDate.optional(),             // default: hoy en Branch.timezone (API)
  cashRegisterId: Uuid.optional(), sellerId: Uuid.optional(), paymentMethod: PaymentMethod.optional(),
}).refine(/* to ≥ from */, { path: ['to'], message: 'La fecha final debe ser igual o posterior a la inicial' })
  .refine(/* daysInRange ≤ MAX_REPORT_DAYS */, { path: ['to'], message: 'El periodo no puede pasar de 366 días' });
export const SalesReportListQuery = SalesReportQuery.and(PaginationQuery.pick({ page: true, pageSize: true }))
  .and(z.object({ status: SaleStatus.optional() }));
export const SalesReportExportQuery = SalesReportQuery.and(z.object({ status: SaleStatus.optional() }));

const RegisterRef = z.object({ id: Uuid, code: z.string(), name: z.string() });
const UserRef = z.object({ id: Uuid, fullName: z.string() });         // igual al de F8, que no lo exporta; pos.ts no se toca

export const SalesReportOptionsDto = z.object({
  registers: z.array(RegisterRef.extend({ isActive: z.boolean() })),
  sellers: z.array(UserRef),
});

export const SalesReportDto = z.object({
  range: z.object({ from: LocalDate, to: LocalDate, timeZone: z.string() }),
  scope: z.enum(['ALL_USERS', 'OWN']),                               // OWN = vendedor o cajero
  totals: z.object({
    salesCount: NonNegativeInt, units: NonNegativeInt,
    subtotal: MoneyCents, discountTotal: MoneyCents, taxTotal: MoneyCents, total: MoneyCents,
    averageTicket: MoneyCents,
  }),
  byMethod: z.array(z.object({ method: PaymentMethod, salesCount: NonNegativeInt, amount: MoneyCents })),   // los 3, siempre
  byRegister: z.array(z.object({ cashRegister: RegisterRef, salesCount: NonNegativeInt, total: MoneyCents })),   // por total desc
  bySeller: z.array(z.object({ seller: UserRef, salesCount: NonNegativeInt, total: MoneyCents })),             // por total desc
  cancelled: z.object({ count: NonNegativeInt, total: MoneyCents }),
});

export const SalesReportRowDto = SaleListItemDto.extend({
  cashRegister: RegisterRef, units: NonNegativeInt,
});
```

`SaleListItemDto` y `SaleTicketDto` son de F8 (`pos.ts`); `PaymentMethod`, `SaleStatus` y `Uuid` de F1; `PaginationQuery` y `paginated` de F1. Los tipos se exportan con `z.infer`.

### 5.2 `errors.ts`

| Código | HTTP | Mensaje |
|---|---|---|
| `REPORT_RANGE_TOO_LARGE` | 400 | "El periodo no puede pasar de 366 días." |
| `REPORT_TOO_LARGE` | 400 | "El reporte tiene más de 20 000 ventas; acorta el periodo para exportarlo." (`details: { rows, max }`) |

---

## 6. Endpoints

Todos bajo `/api/v1/reports`, con tag `reports`, `branchScoped` y `reports.sales`. Las respuestas de error son `ApiErrorDto`.

| Método y ruta | Request | Respuestas |
|---|---|---|
| `GET /sales/options` | — | 200 `SalesReportOptionsDto` |
| `GET /sales` | `SalesReportQuery` | 200 `SalesReportDto` · 400 (`VALIDATION_ERROR`, `REPORT_RANGE_TOO_LARGE`) · 403 `BRANCH_FORBIDDEN` (caja de otra sucursal) |
| `GET /sales/list` | `SalesReportListQuery` | 200 `paginated(SalesReportRowDto)` (por `createdAt` desc) · 400 · 403 |
| `GET /sales/export` | `SalesReportExportQuery` | 200 `.xlsx` · 400 (`REPORT_RANGE_TOO_LARGE`, `REPORT_TOO_LARGE`) · 403 |
| `GET /sales/:id` | — | 200 `SaleTicketDto` · 400 (id no UUID) · 403 (`FORBIDDEN` fuera de su visibilidad, `BRANCH_FORBIDDEN` de otra sucursal) |

---

## 7. Pantallas (wireframe en texto)

**Reportes (`/reports`)**, móvil:

```
┌──────────────────────────────┐
│ Reporte de ventas    [⬇ .xlsx]│
│ [Hoy●][Ayer][7 días][Este mes]│
│ 01/10/2026 – 06/10/2026 [📅] │  ← rango personalizado
│ Hora de America/Mexico_City  │
│ [Caja ▾] [Vendedor ▾] [Pago ▾]│  ← Vendedor solo con all_users
│ Ves las ventas que atendiste o cobraste.   ← solo sin all_users
├──────────────────────────────┤
│ Total        $48,250.00      │
│ Ventas 52 · Unidades 61      │
│ Ticket promedio $927.88      │
│ Subtotal $50,100.00          │
│ Descuentos −$1,850.00        │
│ IVA (incluido) $6,655.17     │
│ ┌ Canceladas: 2 ($1,248.00) ┐│  ← tarjeta aparte, no suma
├──────────────────────────────┤
│ Por método                   │
│  Efectivo      31  $27,900.00│
│  Tarjeta       19  $18,850.00│
│  Transferencia  3   $1,500.00│
│ Por caja · Por vendedor  [▸] │  ← secciones plegables
├──────────────────────────────┤
│ Ventas  [Todas ▾]            │  ← Todas / Completadas / Canceladas
│ S1-000052 · 18:42 · C1       │
│   Ana · 2 pzas · Efectivo    │
│                   $1,248.00 ›│
│ S1-000051 · 18:10 · C2  CANCELADA
│ …            [Cargar más]    │
└──────────────────────────────┘
```

En escritorio, filtros arriba, tarjetas en una fila, desgloses en tres columnas y la lista en `DataTable` (Folio, Fecha y hora, Caja, Vendedor, Cajero, Cliente, Piezas, Métodos, Total, Estado). Sin ventas en el periodo: "No hay ventas en este periodo" (las tarjetas en $0.00). La línea de IVA dice "IVA (incluido)" si todas las ventas del periodo tienen `pricesIncludeTax`, y "IVA" si no.

**Detalle (`/reports/sales/:id`)**: el `SaleTicket` de F8 en pantalla (cancelada con "*** CANCELADA ***", motivo, quién y cuándo), con [Reimprimir] y [← Volver al reporte] (conserva los filtros).

**Exportar**: [⬇ .xlsx] descarga con los filtros actuales (incluido el estado de la lista). Mientras se genera, el botón muestra "Generando…"; un 400 `REPORT_TOO_LARGE` muestra su mensaje.

---

## 8. Reglas y casos borde

1. **Borde del día:** con `America/Mexico_City` (UTC−6), una venta a las 23:59 del 1 de octubre (05:59Z del 2) cuenta en el 1; una a las 00:01 del 2 (06:01Z), en el 2.
2. **Cambio de zona horaria** en Ajustes: el siguiente reporte agrupa todas las ventas, también las pasadas, con la zona nueva (F5).
3. **Periodo sin ventas:** 200 con ceros, `byMethod` con los 3 métodos en 0, `byRegister` y `bySeller` vacíos.
4. **Venta cancelada:** no suma en totales ni desgloses; cuenta en `cancelled` por su fecha de cobro, aunque se haya cancelado otro día. En la lista aparece con estado "Cancelada".
5. **Pago mixto:** suma cada monto a su método y cuenta la venta en ambos métodos; `salesCount` la cuenta una vez. El filtro `paymentMethod=CARD` la incluye completa (con todo su total).
6. **Venta de total 0** (descuento total): cuenta en `salesCount` y unidades; no aparece en `byMethod`.
7. **Visibilidad "vendedor o cajero":** el ejemplo de F9 (Ana atendió 000001 y 000002, cobró 000002 y 000003; Juan atendió 000003 y 000004, cobrada por Luis) → Ana ve 000001–000003 por $2,448; su `bySeller` muestra Ana $1,248 y Juan $1,200. Un Gerente ve las 4.
8. **Detalle fuera de visibilidad:** Ana pide 000004 → 403 `FORBIDDEN`.
9. **Otra sucursal:** sus ventas nunca aparecen; una caja de otra sucursal en el filtro → 403 `BRANCH_FORBIDDEN`; el detalle de una venta de otra sucursal → 403 `BRANCH_FORBIDDEN`.
10. **Caja inactiva:** aparece en las opciones y en los desgloses si tiene ventas en el periodo.
11. **Rango inválido:** `to` antes de `from` → 400 en `to`; más de 366 días → 400 `REPORT_RANGE_TOO_LARGE`.
12. **Exportación grande:** más de 20 000 ventas → 400 `REPORT_TOO_LARGE` con `rows` y `max`.
13. **Totales que cuadran:** `totals.total` = Σ `Sale.total` de las ventas que cuentan; Σ `byRegister.total` = Σ `bySeller.total` = `totals.total`; en efectivo, para una caja y un día con una sola sesión, el monto de `byMethod` `CASH` = esperado del corte (F8) − fondo.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Verificar el cambio de F1.**
  - `@@index([cashierId, createdAt])` en `Sale` ya existe: lo implementa F1, que lo incluye en su spec (§4.6). F9 no toca `schema.prisma` ni migraciones.
  - *Verificable:* F1 T16 en verde con el índice.
- [ ] **2. Contratos.**
  - `shared/reports.ts` (esquemas, `reportPresetRange`, `daysInRange`, DTOs) y los 2 códigos de error (también en la API). Tests **T1–T3**.
  - *Verificable:* T1–T3 en verde.
- [ ] **3. API: resumen y opciones.**
  - `reports.repository.ts` (agregaciones SQL), `reports.service.ts` (visibilidad, default de fechas, ticket promedio) y `reports.routes.ts` (`/sales/options`, `/sales`); registrar en `app.ts`; helper de test para sembrar ventas con fecha, caja, vendedor, cajero, pagos y estado. Tests **T4–T9** y **T14**.
  - *Verificable:* T4–T9 y T14 en verde.
- [ ] **4. API: lista y detalle.**
  - `/sales/list` y `/sales/:id` (reutiliza el armado de `SaleTicketDto` de F8). Tests **T10–T11**.
  - *Verificable:* T10 y T11 en verde.
- [ ] **5. API: exportación.**
  - `xlsx.ts` y `/sales/export`. Tests **T12–T13** y **T16** (las 5 rutas ya existen).
  - *Verificable:* T12, T13 y T16 en verde.
- [ ] **6. API: rendimiento.**
  - Helper que siembra un mes de ventas por SQL; medir el resumen y la primera página de la lista. Test **T15**.
  - *Verificable:* T15 en verde.
- [ ] **7. UI: filtros y resumen.**
  - `ReportsPage`, `ReportFilters` (atajos, rango, caja, vendedor, método, en la URL), `SummaryCards` y `Breakdowns`; ruta y guard. Tests **T17–T18** y **T22**.
  - *Verificable:* T17, T18 y T22 en verde.
- [ ] **8. UI: lista, detalle y exportar.**
  - `SalesList`, `SaleDetailPage` (con reimpresión) y `ExportButton`. Tests **T19–T21**.
  - *Verificable:* T19–T21 en verde.
- [ ] **9. README y cierre.**
  - En el README: cómo leer el reporte (canceladas aparte, zona horaria, visibilidad "vendedor o cajero") y cómo exportar.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer la verificación manual (§11); registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 22)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (`S1` y `S2`, cada una con `C1` y `C2`) más ventas sembradas con el helper de §9.3 (fecha `createdAt` controlada, sin pasar por el POS, salvo T11 y T16, que cobran con el flujo de F8). Los de `web` usan Jest + RTL con `fetch` simulado y reloj falso.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `reports.test.ts` | `SalesReportQuery`: vacío válido; `from: '2026-1-5'` → error; `to` antes de `from` → error en `to`; `2026-01-01`–`2026-12-31` (365) y `2024-01-01`–`2024-12-31` (366) válidos, 367 días → error; `paymentMethod: 'CHEQUE'` → error. `SalesReportListQuery` acepta `page`, `pageSize` y `status`. `daysInRange('2026-10-01', '2026-10-31')` → 31. |
| T2 | `shared` · `reports.test.ts` | `reportPresetRange` con `now = 2026-10-02T05:30:00Z` y `America/Mexico_City` (aún 1 de octubre local): `TODAY` → `2026-10-01`/`2026-10-01`; `YESTERDAY` → `2026-09-30`; `LAST_7_DAYS` → `2026-09-25`–`2026-10-01`; `THIS_MONTH` → `2026-10-01`–`2026-10-01`. Con `UTC`, `TODAY` → `2026-10-02`. `REPORT_PRESET_LABELS` cubre los 4. |
| T3 | `shared` · `errors.test.ts` + `reports.test.ts` | Los 2 códigos nuevos existen. Las fixtures de `SalesReportDto` (con datos y vacío), `SalesReportRowDto` (completada y cancelada) y `SalesReportOptionsDto` son válidas; un `SalesReportDto` con `byMethod` decimal se rechaza. |
| T4 | `int` · `reports-summary.int.test.ts` | Con 5 ventas completadas en `S1` el mismo día (con descuentos de partida y global, IVA incluido): `totals` = suma exacta de `subtotal`, `discountTotal`, `taxTotal` y `total` de esas ventas; `units` = Σ cantidades; `averageTicket` redondeado a medio hacia arriba; Σ `byRegister.total` = Σ `bySeller.total` = `totals.total`; `range.timeZone` = la de la sucursal. |
| T5 | `int` · `reports-summary.int.test.ts` | Borde del día en `America/Mexico_City`: ventas a `2026-10-02T05:59Z` y `06:01Z` → `from=to=2026-10-01` trae solo la primera y `2026-10-02` solo la segunda; sin `from`/`to` usa hoy en la zona de la sucursal (reloj controlado); tras cambiar `Branch.timezone` a `America/Tijuana`, la agrupación cambia. |
| T6 | `int` · `reports-summary.int.test.ts` | Canceladas: 3 completadas y 2 canceladas (una cancelada otro día) → `totals` y desgloses solo con las 3; `cancelled` = `{ count: 2, total }` por fecha de cobro. Periodo sin ventas → ceros, `byMethod` con los 3 métodos en 0 y desgloses vacíos. |
| T7 | `int` · `reports-summary.int.test.ts` | Métodos: una venta en efectivo, una con tarjeta y una mixta (efectivo + transferencia) → `byMethod` `CASH` `salesCount` 2 y monto Σ, `CARD` 1, `TRANSFER` 1; `salesCount` total 3; Σ `byMethod.amount` = `totals.total`. Una venta de total 0 cuenta en `salesCount` y no en `byMethod`. El monto `CASH` de una caja con una sola sesión = esperado del corte de F8 − fondo. |
| T8 | `int` · `reports-summary.int.test.ts` | Filtros: `cashRegisterId=C2` solo trae las de `C2`; `sellerId` solo las que ese usuario atendió; `paymentMethod=CARD` trae la venta mixta completa; combinados se intersectan; `cashRegisterId` de una caja de `S2` → 403 `BRANCH_FORBIDDEN`; las ventas de `S2` nunca aparecen. |
| T9 | `int` · `reports-access.int.test.ts` | Visibilidad con el ejemplo de §8.7: Ana (Vendedora, sin `all_users`) → `scope: 'OWN'`, 3 ventas por 244800 y `bySeller` Ana 124800 / Juan 120000; con `sellerId` = Juan → solo 000003; un Gerente → `scope: 'ALL_USERS'` y las 4; un usuario sin `reports.sales` → 403 en `GET /sales` y `GET /sales/options`. |
| T10 | `int` · `reports-list.int.test.ts` | `GET /sales/list`: orden `createdAt` desc, paginación (`page`, `pageSize`, `total`), cada fila con caja, vendedor, cajero, unidades y métodos; `status=CANCELLED` solo canceladas; misma visibilidad que el resumen (Ana no ve 000004). |
| T11 | `int` · `reports-list.int.test.ts` | `GET /sales/:id` de una venta cobrada con el flujo de F8 → `SaleTicketDto` igual al de `GET /pos/sales/:id/ticket`; para un rol con solo `reports.sales` (sin `pos.sell`) → 200; Ana pide 000004 → 403 `FORBIDDEN`; venta de `S2` → 403 `BRANCH_FORBIDDEN`; id no UUID → 400. |
| T12 | `int` · `reports-export.int.test.ts` | `GET /sales/export` → `Content-Type` de `.xlsx` y `filename="ventas-S1-2026-10-01_2026-10-31.xlsx"`; leído con `exceljs`: hojas `Resumen` y `Ventas`; la hoja `Ventas` tiene una fila por venta visible con los encabezados de §3, montos en pesos con formato `$#,##0.00` (124800 → 1248) y fecha local; los totales de `Resumen` coinciden con `GET /sales`; respeta `status` y la visibilidad. |
| T13 | `int` · `reports-export.int.test.ts` | Con `MAX_EXPORT_ROWS` reducido por configuración del test (p. ej. 3) y 4 ventas → 400 `REPORT_TOO_LARGE` con `details: { rows: 4, max: 3 }`; 367 días → 400 `REPORT_RANGE_TOO_LARGE`. |
| T14 | `int` · `reports-summary.int.test.ts` | `GET /sales/options`: las cajas de `S1` (incluida una inactiva) y, para un Gerente, los vendedores con ventas en `S1`; para Ana, solo ella. |
| T15 | `int` · `reports-performance.int.test.ts` | Con 9 000 ventas sembradas en 30 días (300 al día, 1–3 partidas y 1–2 pagos cada una) en `S1` y 2 000 en `S2`: `GET /sales` del mes completo y la primera página de `GET /sales/list` responden en menos de 1 s cada uno (mediana de 3 llamadas tras una de calentamiento). Volumen supuesto, pendiente de la pregunta §13.8 del plan. |
| T16 | `int` · `reports-access.int.test.ts` | `/api/docs/json` agrupa las 5 rutas bajo el tag `reports` con `security`; un usuario sin `reports.sales` recibe 403 en cada una (`it.each`). |
| T17 | `web` · `ReportFilters.test.tsx` | Con reloj falso y la zona de la sucursal: "Hoy" está activo por defecto; "Ayer", "7 días" y "Este mes" ponen el `from`/`to` de `reportPresetRange`; el rango personalizado se envía tal cual; caja, vendedor y método van a la consulta y a la URL; el filtro de vendedor solo aparece con `all_users`, y sin él se muestra "Ves las ventas que atendiste o cobraste."; un rango de más de 366 días muestra el error sin llamar a la API. |
| T18 | `web` · `SummaryCards.test.tsx` | Con un `SalesReportDto`: total, ventas, unidades, ticket promedio, subtotal, descuentos e IVA con `Money`; la tarjeta "Canceladas: 2 ($1,248.00)" aparte; los tres desgloses; "IVA (incluido)" cuando corresponde; un reporte vacío muestra "No hay ventas en este periodo". |
| T19 | `web` · `SalesList.test.tsx` | Muestra folio, hora (zona de la sucursal), caja, vendedor, piezas, métodos y total; una cancelada con "Cancelada"; el selector Todas/Completadas/Canceladas envía `status`; "Cargar más" pide la página siguiente; tocar una fila abre `/reports/sales/:id` conservando los filtros en la URL. |
| T20 | `web` · `SaleDetailPage.test.tsx` | Muestra el `SaleTicket` de la venta; "Reimprimir" monta `PrintLayout` `ticket-80` y llama a `window.print`; con `wm.pos.ticketWidth = 58` usa `ticket-58`; si `localStorage` lanza error, usa 80 mm; un 403 muestra "Sin acceso a esta venta"; "Volver al reporte" conserva los filtros. |
| T21 | `web` · `ExportButton.test.tsx` | Llama a `/reports/sales/export` con los filtros actuales (incluido `status`), crea el enlace de descarga con el nombre de `Content-Disposition` y lo libera; muestra "Generando…" mientras tanto; un 400 `REPORT_TOO_LARGE` muestra su mensaje. |
| T22 | `web` · `ReportsPage.test.tsx` | Sin `reports.sales`, el módulo Reportes no aparece en el menú y `/reports` muestra "Sin acceso"; con él, la página pide `options`, el resumen y la lista con los mismos filtros, y muestra "Hora de America/Mexico_City". |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F8 siguen en verde (F1 T16 con el índice nuevo).

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Los totales del reporte cuadran con la suma de las ventas, incluido el borde del día en la zona horaria de la sucursal. | T4, T5, T7 |
| CA2 | La consulta de un mes completo responde en menos de 1 s con el volumen esperado. | T15 (volumen supuesto hasta responder §13.8) |
| CA3 | Las ventas canceladas no suman en los totales ni en los desgloses y se muestran aparte; el efectivo del reporte cuadra con el corte de F8. | T6, T7, T18 |
| CA4 | Sin `reports.sales.all_users`, el usuario solo ve las ventas que atendió o cobró, en resumen, lista, detalle y exportación. | T9, T10, T11, T12, T17 |
| CA5 | Desde el reporte se abre el detalle de una venta y se reimprime su ticket a 80 mm. | T11, T20 + verificación manual en la Epson TM-T20III |
| CA6 | El reporte se exporta a `.xlsx` con los mismos filtros y totales que la pantalla, y se abre en Excel. | T12, T13, T21 + verificación manual (Excel o LibreOffice) |
| CA7 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F8. | Salida de los comandos en §12 |
| CA8 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-06 | Las ventas canceladas no cuentan en los totales ni en los desgloses (solo `COMPLETED`, como el corte de F8); se muestran en una tarjeta aparte y, marcadas, en la lista, con filtro por estado. | Usuario (chat); plan §8 F9 actualizado |
| 2026-10-06 | Exportar a `.xlsx` entra en F9 (hojas Resumen y Ventas, con `exceljs` en la API). | Usuario (chat); plan §8 F9 actualizado |
| 2026-10-06 | Sin `reports.sales.all_users`, "sus propias ventas" = las que atendió (`sellerId`) **o** cobró (`cashierId`), igual que el historial de caja de F8. | Usuario (chat), tras ver el ejemplo de Ana; plan §8 F9 actualizado |
| 2026-10-06 | Índice `Sale[cashierId, createdAt]` como cambio declarado en F1. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Resumen (`GET /reports/sales`) y lista (`GET /reports/sales/list`) en endpoints separados, más `options`, detalle y exportación. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | El desglose por vendedor agrupa por quien atendió; el filtro `paymentMethod` incluye la venta mixta completa; una venta de total 0 no aparece en `byMethod`. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Las canceladas cuentan por su fecha de cobro, no por la de cancelación. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | `GET /reports/sales/:id` con `reports.sales` devuelve el `SaleTicketDto` de F8, para que un rol sin `pos.sell` pueda ver y reimprimir. Fuera de su visibilidad → 403 `FORBIDDEN`. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Periodo máximo de 366 días; exportación de hasta 20 000 ventas; dinero en pesos con formato de moneda solo en el `.xlsx`. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | Rendimiento medido con 9 000 ventas en un mes (300 al día) como volumen supuesto, mientras la pregunta §13.8 del plan siga pendiente. | Propuesta del agente; revisar al aprobar |
| 2026-10-06 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Se aplica el índice en F1 (§4.6). Spec pasa a `LISTA`. | Usuario (chat) |
