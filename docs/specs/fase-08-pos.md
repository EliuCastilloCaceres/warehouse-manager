---
id: fase-08
titulo: Punto de venta (POS)
estado: LISTA
depende_de: [fase-05, fase-07]
autoriza_codigo_en:
  - "apps/api/src/modules/pos/**"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/core/errors.test.ts"
  - "apps/api/src/app.ts"
  - "apps/api/test/integration/pos-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/pos.ts"
  - "packages/shared/src/pos.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "apps/web/src/features/pos/**"
  - "apps/web/src/features/settings/previewTotals.ts"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Devoluciones y cancelación parcial o con la caja cerrada (post-MVP, plan §11)"
  - "Cupones validados por el sistema; el QR de promoción solo se muestra y el descuento se captura a mano (post-MVP, plan §11)"
  - "Retiros o depósitos de efectivo durante el turno, y fondo de caja por denominación"
  - "Facturación electrónica (CFDI) y datos del cliente más allá del nombre (plan §13.2 y §13.12)"
  - "Impresión directa ESC/POS, apertura del cajón de dinero y modo offline (post-MVP)"
  - "Transferir stock desde otra sucursal o reservarlo allá; \"En otras sucursales\" es solo lectura"
  - "Reportes de ventas por periodo y reimpresión desde reportes (F9)"
  - "Cambios en InventoryService (F2), en la consulta locate de F7 o en los componentes de ticket de F5"
  - "Cambios a schema.prisma o migraciones fuera de los declarados en F1 (Sale.cashierId, Cart.branchId, Cart.number y sus índices)"
tests_requeridos_total: 36
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/pos/**, apps/web/src/features/pos/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 8: Punto de venta (POS)

## 1. Contexto y alcance

Referencias: plan §1.2 (POS), §3 (convenciones), §4.2 (`CashSession`, `Cart`, `CartItem`, `Sale`, `SaleItem`, `Payment`, `BranchCounter`), §4.3 (flujo POS ↔ stock y concurrencia), §5.3 (QR de promoción), §6.2 (permisos `pos.*` e `inventory.other_branches.read`), §7 (escaneo e impresión), §8 Fase 8, §9 (pruebas) y §13.1, §13.3–13.5 y §13.12. Se apoya en F1 (modelo, `BranchCounter`, `applyBasisPoints`, `classifyScan`), F2 (`InventoryService`: `pick`, `release`, `moveReservedToStaging`, `sell`, `returnCancelledSaleToStaging`; `branchContext`; `AuditService`), F3 (`ScanInput`, `PrintLayout`, `QrCode`, `ResponsiveDialog`, `ConfirmDialog`, `Money`, formato de fechas), F5 (`TicketHeader`, `TicketFooter`, `PromoBlock`, datos de ticket de `Branch`) y F7 (`inventory.queries.locate()` con `otherBranches`).

**Objetivo:** vender desde el piso con el flujo real de atención. Al terminar F8:

- el vendedor toca **"Atender"** y arma el carrito desde su celular sin elegir caja: busca un producto, ve sus tallas y colores con existencias y ubicaciones (y, con permiso, cuánto hay en otras sucursales) y lo agrega desde un rack, lo que reserva la unidad;
- cada vendedor tiene un carrito activo y hasta 5 suspendidos en la sucursal; al quitar un producto elige regresarlo a su ubicación o mandarlo a staging;
- cada carrito abierto tiene un número corto ("Carrito #12") con el que el cajero lo encuentra;
- quien cobra (el cajero o el mismo vendedor) lo hace desde un dispositivo en una caja abierta, y puede verificar las piezas escaneándolas; la venta y su dinero quedan en **esa** caja, y guardan quién armó el carrito y quién cobró;
- el ticket se imprime solo o con vista previa, se reimprime y muestra los datos configurados en Ajustes;
- un Administrador o Gerente cancela una venta completa mientras su caja siga abierta;
- el corte es ciego: primero se captura el efectivo contado y después se ve el esperado y la diferencia.

**Alcance (entra):**

1. Cambios declarados en F1: `Sale.cashierId`, `Cart.branchId` (en lugar de `cashSessionId`), `Cart.number` y los índices "un carrito activo por vendedor" y "número único entre carritos abiertos" (§2).
2. Contratos del POS en `shared` (`pos.ts`), con `computeSaleTotals`, la regla definitiva de impuestos.
3. Endpoints de caja, carritos, partidas, cobro, ticket, historial de la caja, cancelación, búsqueda y datos de ticket de la sucursal.
4. UI del POS: Atender (venta), barra de carritos, carritos de la sucursal, caja para cobrar, cobro, ticket, historial, cancelación y corte.

**Fuera de alcance:** ver la cabecera. **Regresión declarada de F5:** `previewTotals` (vista previa del ticket en Ajustes) pasa a delegar en `computeSaleTotals` de `shared`, como F5 anunció; sus tests (T22–T23 de F5) siguen en verde sin cambios, porque la regla da los mismos montos. Es el único cambio permitido sobre entregables de F5.

---

## 2. Modelo de datos afectado

**Cambios en F1** (F1 está `LISTA` sin implementar; se aplican en su spec, decisiones del usuario 2026-10-05):

| Cambio | Detalle |
|---|---|
| `Sale.cashierId` | `String`, FK `User` "SaleCashier" (`Restrict`): quien cobró. `sellerId` sigue siendo quien armó el carrito (`Cart.userId`). |
| `Cart.branchId` | Reemplaza a `Cart.cashSessionId`: el carrito es de la sucursal, no de una caja. Índice `[branchId, status]`. |
| Índice `cart_one_active_per_user_branch` | `UNIQUE (branch_id, user_id) WHERE status = 'ACTIVE'`: cada vendedor tiene a lo sumo un carrito activo en la sucursal. |
| `Cart.number` | `Int` 1–999 (`CHECK cart_number_check`), con el índice `cart_number_open_per_branch` = `UNIQUE (branch_id, number) WHERE status IN ('ACTIVE', 'SUSPENDED')`: el número es único entre los carritos abiertos de la sucursal y se libera al cobrar o descartar. |

Usa además `CashRegister`, `CashSession`, `CartItem`, `SaleItem`, `Payment`, `BranchCounter` (`SALE_FOLIO`), `StockLocation`, `InventoryMovement` y `AuditLog`. Todo cambio de stock pasa por `InventoryService` (F2).

| Concepto | Regla en F8 |
|---|---|
| Sesión de caja | Una por caja como máximo (`cash_session_one_open_per_register`, F1). Solo se necesita para **cobrar**: el dispositivo que cobra recuerda su caja. Para atender basta con que la sucursal tenga al menos una caja abierta. |
| Carritos | Pertenecen a la sucursal y a su vendedor (`userId`). Por vendedor y sucursal: 1 `ACTIVE` como máximo y hasta 5 `SUSPENDED` (`MAX_SUSPENDED_CARTS_PER_USER`). |
| Carrito editable | `ACTIVE` o `SUSPENDED`. `CHECKED_OUT` y `DISCARDED` son finales. |
| Número de carrito | Al crearlo se asigna el **menor número libre** (1–999) entre los carritos abiertos de la sucursal; lo conserva al suspender y retomar. |
| Reserva | Cada partida reserva su cantidad en `sourceRackId` (`PICK`). Suspender no libera nada. |
| Precio | `CartItem.unitPrice` = precio efectivo de la variante al agregarla (`priceOverride ?? product.price`). No cambia si el precio del catálogo cambia después. |
| Venta | `cashSessionId` y `cashRegisterId` = la caja desde la que se cobra; `sellerId` = dueño del carrito; `cashierId` = quien cobra; `taxRateBp` y `pricesIncludeTax` se copian de la sucursal al cobrar. |
| Folio | `{Branch.code}-{n}` con `n` de 6 dígitos (más si pasa de 999 999), desde `BranchCounter` (`UPDATE … RETURNING`) en la transacción del cobro. |
| Esperado del corte | `openingAmount` + Σ `Payment.amount` de método `CASH` de las ventas `COMPLETED` **cobradas en esa sesión**. El cambio entregado ya está descontado, porque `amount` es lo cobrado y no lo recibido. Las ventas canceladas no cuentan. |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulo | `apps/api/src/modules/pos/` con `sessions.routes.ts`, `carts.routes.ts`, `sales.routes.ts`, `pos.routes.ts` (búsqueda y sucursal), `sessions.service.ts`, `carts.service.ts`, `checkout.service.ts`, `sales.service.ts` y `pos.repository.ts`. Reutiliza `InventoryService` (F2) y `inventory.queries.locate()` (F7) sin modificarlos. Tag de Swagger `pos`. Todas las rutas son `branchScoped`. |
| Pertenencia a la sucursal | Una sesión, carrito o venta de otra sucursal que la de `request.branchId` → 403 `BRANCH_FORBIDDEN` (también si el id no existe, como F5). Id no UUID → 400. |
| Modelo de operación | Decisiones del usuario: "vendedor arma, caja cobra", con el botón **"Atender"** y la venta **en la caja que cobra**. Cualquier usuario con `pos.sell` en la sucursal ve, edita, descarta y cobra los carritos de cualquier vendedor. Solo el dueño suspende o retoma su carrito (los demás → 403 `FORBIDDEN`). |
| Caja abierta para atender | Crear un carrito y agregar partidas exigen que la sucursal tenga al menos una sesión `OPEN` (si no → 409 `NO_OPEN_CASH_SESSION`). Quitar partidas, descartar y suspender no lo exigen, para poder liberar reservas siempre. |
| Número corto | Se asigna dentro de la transacción de alta con un bloqueo transaccional por sucursal (`pg_advisory_xact_lock`), así dos altas simultáneas no chocan. Si los 999 están ocupados → 409 `CONFLICT` (no ocurre en la práctica). Se muestra como "Carrito #12" en la barra de carritos del vendedor, en la lista de carritos de la sucursal y en el cobro. `GET /pos/carts?number=12` lo busca. |
| Verificación en caja | Decisión del usuario (opción "opcional pero visible"). En el cobro, el cajero escanea las piezas con `ScanInput` (`captureHid`): una lectura de producto que coincide con el SKU o el código de barras de una partida suma 1 a sus verificadas, hasta su cantidad ("2 de 3 verificadas"); una pieza de más de esa partida avisa "Ya verificaste todas las piezas de esta partida"; una que no está en el carrito avisa "Este producto no está en el carrito" (no se agrega sola); un SKU padre de un producto variable pide escanear la etiqueta de la variante. El estado es del cliente (no se guarda mientras se verifica). Si faltan piezas, "Confirmar cobro" pide confirmar "Faltan N piezas por verificar. ¿Cobrar de todos modos?". El cobro envía `verifiedUnits`; si es menor que las unidades del carrito, el servidor registra `pos.checkout.unverified` en el audit (`saleId`, `verifiedUnits`, `totalUnits`); si es mayor → 400 en `verifiedUnits`. |
| Carrito nuevo | `POST /pos/carts`: si el usuario ya tiene un `ACTIVE` vacío, se reutiliza (200, con la etiqueta nueva si se envía); si tiene uno con partidas, ese pasa a `SUSPENDED` (con el límite) y se crea otro `ACTIVE` (201). |
| Retomar | `POST /pos/carts/:id/resume`: el `ACTIVE` actual del dueño pasa a `SUSPENDED` si tiene partidas o se descarta si está vacío; el retomado pasa a `ACTIVE`. Todo en una transacción; el número de suspendidos no cambia. |
| Límite de suspendidos | 5 por vendedor y sucursal (decisión del usuario). Se cuenta dentro de la transacción con un bloqueo transaccional por (sucursal, vendedor) (`pg_advisory_xact_lock`); el sexto → 409 `CART_LIMIT_REACHED`. |
| Agregar partida | `POST /pos/carts/:id/items` con `{variantId, sourceRackId, quantity}`: la variante debe estar efectivamente activa (si no → 409 `VARIANT_INACTIVE`); el rack debe ser de un almacén de la sucursal del carrito (si no → 400 en `sourceRackId`); `InventoryService.pick` con `reference: { type: 'CART', id }`. Si ya existe una partida con la misma variante y el mismo rack, se suma a ella. Staging se acepta como origen. |
| Cambiar cantidad | `PATCH …/items/:itemId` con `quantity`: si sube, `pick` de la diferencia; si baja, se libera la diferencia según `releaseTo` (`RACK` → `release`, `RETURN_TO_RACK`; `STAGING` → `moveReservedToStaging`, `TO_STAGING`; por defecto `RACK`). |
| Quitar o descartar | `DELETE …/items/:itemId?releaseTo=` libera la partida completa. `POST /pos/carts/:id/discard` con `releaseTo` libera todas las partidas con la misma acción y deja el carrito `DISCARDED`. |
| Descuentos | Por partida (`CartItem.discount`) y global (`Cart.discount`), en centavos, solo con `pos.discount` (si no → 403 `FORBIDDEN` con `details.permission`). La UI puede capturar un porcentaje y convertirlo con `applyBasisPoints`. Un descuento de partida no supera `unitPrice × quantity`; el global no supera Σ de las partidas ya descontadas (400 en `discount`). Si una partida baja de cantidad, su descuento se recorta al nuevo importe; si el total de partidas baja, el global se recorta igual. |
| Impuestos | Decisión del usuario: se calculan **una vez sobre el total** con `computeSaleTotals` (§5). Con IVA incluido: `total = subtotal − descuentos` e `IVA = total − redondeo(total × 10000 ÷ (10000 + bp))`. Sin IVA incluido: `IVA = applyBasisPoints(subtotal − descuentos, bp)` y `total = subtotal − descuentos + IVA`. Redondeo a medio hacia arriba con aritmética entera. Cumple `sale_total_check` (F1). |
| Pagos | De 1 a 3, a lo sumo uno por método. Σ `amount` = `total` (si no → 400 `PAYMENT_TOTAL_MISMATCH` con `details: { total, paid }`). `CASH` admite `received ≥ amount` y guarda `change = received − amount`; tarjeta y transferencia no llevan `received` y admiten `reference` opcional (1–60). Con `total = 0` no se envían pagos. |
| Cobro | `POST /pos/carts/:id/checkout` con `cashSessionId` (la caja del dispositivo que cobra), una transacción: validar que la sesión sea de la sucursal y esté `OPEN` (si no → 409 `CASH_SESSION_CLOSED`); bloquear el carrito (`FOR UPDATE`) y validar que sea editable y no vacío; calcular totales con la configuración actual de la sucursal; validar pagos; generar el folio; crear `Sale` (caja y sesión que cobran, `sellerId` = dueño, `cashierId` = actor), `SaleItem` con *snapshots* (`skuSnapshot`, `nameSnapshot`, `variantLabelSnapshot` como en F6: `"25 · Negro"`) y `Payment`; `InventoryService.sell` por partida con `reference: { type: 'SALE', id }`; carrito `CHECKED_OUT`. Responde el `SaleTicketDto`. |
| Ticket | `SaleTicketDto` = venta + partidas + pagos + caja + vendedor + cajero + `TicketBranchDto` (los datos de ticket **actuales** de la sucursal). Así el vendedor imprime sin `settings.branch`. `GET /pos/branch` devuelve el mismo `TicketBranchDto` para el POS (QR de promoción). |
| Componente de ticket | `SaleTicket` en `features/pos/ticket/`: `TicketHeader` + folio, fecha y hora (zona de la sucursal), caja, "Le atendió", "Cajero", cliente, partidas (con descuento), subtotal, descuentos, IVA ("IVA incluido" o "IVA 16 %"), total, pagos (efectivo con recibido y cambio; referencia de tarjeta o transferencia) + `TicketFooter` (mensaje y QR de promoción, F5). Una venta cancelada muestra "*** CANCELADA ***", el motivo, quién y cuándo. Ancho 80 mm (72 imprimibles) o 58 mm. |
| Impresión | Decisión del usuario: automática y configurable por dispositivo. Al cobrar, si `wm.pos.autoPrint` (localStorage, `true` por defecto) está activo, se monta `PrintLayout` (`ticket-80` o `ticket-58` según `wm.pos.ticketWidth`) y se llama a `usePrint()`; si no, se muestra la vista previa con "Imprimir". Los accesos a `localStorage` van en `try/catch` (sin almacenamiento: imprimir automático y 80 mm). |
| Historial de la caja | `GET /pos/cash-sessions/:id/sales`: ventas cobradas en esa sesión, descendente. Sin `reports.sales.all_users`, el usuario solo ve las ventas donde es vendedor o cajero (como el reporte de F9). Desde ahí se reimprime y, con `pos.sale.cancel`, se cancela. |
| Cancelación | `POST /pos/sales/:id/cancel` con `reason` (3–300): sesión de la venta `OPEN` (si no → 409 `CASH_SESSION_CLOSED`) y venta `COMPLETED` (si no → 409 `SALE_ALREADY_CANCELLED`). En una transacción, por partida `returnCancelledSaleToStaging` en el almacén de su `sourceRackId` (`SALE_CANCEL`, `reference` `SALE`); venta `CANCELLED` con `cancelledAt`, `cancelledById` y `cancelReason`; audit `pos.sale.cancel`. Responde el `SaleTicketDto` actualizado. |
| Abrir caja | `POST /pos/cash-sessions/open` con `pos.session.open`: la caja debe ser activa y de la sucursal; si ya está abierta → 409 `CASH_SESSION_ALREADY_OPEN` (también cuando dos aperturas compiten: lo garantiza el índice único de F1). Audit `pos.session.open`. |
| Corte ciego | Decisión del usuario. `POST /pos/cash-sessions/:id/close` con `pos.session.close` y solo `countedAmount`; la API no expone el esperado de una sesión abierta (`GET …/summary` de una sesión `OPEN` → 409 `CONFLICT`). Lo puede cerrar cualquier usuario con el permiso, no solo quien abrió. Responde `CashSessionSummaryDto` (esperado, contado, diferencia, ventas, canceladas y desglose por método). Audit `pos.session.close`. |
| Carritos pendientes al cerrar | Decisión del usuario. Como los carritos son de la sucursal, solo importan al cerrar la **última** sesión abierta de la sucursal: si hay carritos `ACTIVE`/`SUSPENDED` con partidas → 409 `CASH_SESSION_HAS_OPEN_CARTS` con `details.carts` (`id`, dueño, etiqueta, unidades); los vacíos se descartan solos. `POST /pos/carts/release-all` con `releaseTo` (`pos.session.close`) descarta todos los pendientes de la sucursal y libera sus reservas (al rack o a staging) en una transacción; audit `pos.carts.release_all`. Cerrar y abrir sesiones, crear carritos y agregar partidas bloquean la fila de la sucursal (`FOR UPDATE` al cerrar, `FOR SHARE` en los demás), así que dos cierres simultáneos de las dos últimas cajas no dejan carritos sin caja. |
| Sesión cerrada | Cobrar con una sesión cerrada, o cancelar una venta de una sesión cerrada → 409 `CASH_SESSION_CLOSED`. La web, ante ese código, avisa "La caja se cerró" y lleva a elegir caja para cobrar. |
| Búsqueda | `GET /pos/lookup?code=` (`pos.sell`) devuelve el `LocateResultDto` de F7 (variante o SKU padre, ubicaciones con disponibles, precio efectivo y `otherBranches` con `inventory.other_branches.read`). No exige `warehouse.read`. |
| QR de promoción | Decisión de F5. Una lectura `promo` abre un aviso con el texto; si coincide con `promoQrText` de la sucursal, muestra también `promoQrCaption`. Con `pos.discount` ofrece "Aplicar descuento", que abre el descuento global del carrito activo para capturarlo a mano. El código no se valida ni se guarda. |
| Rutas web | Guard `pos.sell`. `/pos` (Atender: venta; no pide caja), `/pos/carts` (carritos de la sucursal), `/pos/register` (caja para cobrar: abrir o "Cobrar en esta caja"), `/pos/checkout/:cartId` (sin caja en el dispositivo o con su sesión cerrada → `/pos/register?next=`), `/pos/sales` (historial de la caja del dispositivo) y `/pos/close` (corte de esa caja). La caja del dispositivo se guarda en `wm.pos.register.<branchId>`. |
| Consultas web | TanStack Query: `['pos-registers', branchId]`, `['pos-session', id]`, `['pos-carts', branchId, scope]`, `['cart', id]`, `['pos-lookup', code]`, `['pos-sales', sessionId]`. Toda mutación de carrito invalida el carrito, la lista de carritos y `pos-lookup`. La lista de carritos de la sucursal se refresca cada 15 s (`refetchInterval`) para ver los de otros vendedores. |
| Audit | `pos.session.open`, `pos.session.close`, `pos.carts.release_all`, `pos.checkout.unverified` y `pos.sale.cancel`. Reservas, ventas y cancelaciones quedan además en el kardex. |

---

## 4. Dependencias autorizadas (lista cerrada)

Ninguna nueva.

---

## 5. Contratos en `packages/shared`

### 5.1 `pos.ts` (nuevo)

```ts
export const MAX_SUSPENDED_CARTS_PER_USER = 5;
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string>;   // Efectivo, Tarjeta, Transferencia
export const ReleaseTo = z.enum(['RACK', 'STAGING']);
export function formatFolio(branchCode: string, n: number): string;    // ('S1', 123) → 'S1-000123'

export type SaleLineInput = { unitPrice: number; quantity: number; discount: number };
export function computeSaleTotals(input: {
  lines: SaleLineInput[]; globalDiscount: number; taxRateBp: number; pricesIncludeTax: boolean;
}): { subtotal: number; lineDiscounts: number; globalDiscount: number; discountTotal: number; taxTotal: number; total: number };
// Lanza RangeError si un monto no es entero ≥ 0, si un descuento de partida supera su importe
// o si el global supera Σ(unitPrice × quantity − discount).
export function computeChange(received: number, amount: number): number;   // RangeError si received < amount

const UserRef = z.object({ id: Uuid, fullName: z.string() });
const optionalName = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

export const OpenSessionInput = z.object({ cashRegisterId: Uuid, openingAmount: MoneyCents });
export const CloseSessionInput = z.object({ countedAmount: MoneyCents });
export const ReleaseCartsInput = z.object({ releaseTo: ReleaseTo });

export const PosSessionDto = CashSessionDto.extend({
  cashRegister: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  openedBy: UserRef, closedBy: UserRef.nullable(),
});
export const PosRegisterDto = CashRegisterDto.extend({
  openSession: z.object({ id: Uuid, openedAt: IsoDateTime, openedBy: UserRef }).nullable(),
});
export const CashSessionSummaryDto = z.object({
  session: PosSessionDto,
  salesCount: NonNegativeInt, salesTotal: MoneyCents,
  cancelledCount: NonNegativeInt, cancelledTotal: MoneyCents,
  byMethod: z.array(z.object({ method: PaymentMethod, count: NonNegativeInt, amount: MoneyCents })),   // los 3 métodos, siempre
  expectedAmount: MoneyCents, countedAmount: MoneyCents, difference: SignedMoneyCents,
});

export const CartCreateInput = z.object({ label: optionalName(60).optional(), customerName: optionalName(120).optional() });
export const CartUpdateInput = z.strictObject({
  label: optionalName(60).optional(), customerName: optionalName(120).optional(), discount: MoneyCents.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' });
export const CartSuspendInput = z.object({ label: optionalName(60).optional(), customerName: optionalName(120).optional() });
export const CartDiscardInput = z.object({ releaseTo: ReleaseTo });
export const CartItemAddInput = z.object({ variantId: Uuid, sourceRackId: Uuid, quantity: Quantity });
export const CartItemUpdateInput = z.strictObject({
  quantity: Quantity.optional(), discount: MoneyCents.optional(), releaseTo: ReleaseTo.default('RACK'),
}).refine((v) => v.quantity !== undefined || v.discount !== undefined, { message: 'Indica la cantidad o el descuento' });
export const CartListQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  number: z.coerce.number().int().min(1).max(999).optional(),   // buscar "Carrito #12"
});

export const SaleTotalsDto = z.object({
  subtotal: MoneyCents, lineDiscounts: MoneyCents, globalDiscount: MoneyCents, discountTotal: MoneyCents,
  taxTotal: MoneyCents, total: MoneyCents, taxRateBp: BasisPoints, pricesIncludeTax: z.boolean(),
});
export const CartItemRowDto = CartItemDto.extend({
  sku: z.string(), barcode: z.string().nullable(),       // para la verificación en caja
  productName: z.string(), variantLabel: z.string().nullable(), thumbUrl: z.string().nullable(),
  locationCode: z.string(), isStaging: z.boolean(), lineTotal: MoneyCents,
});
export const CartDetailDto = CartDto.extend({ owner: UserRef, items: z.array(CartItemRowDto), totals: SaleTotalsDto });
export const CartSummaryDto = CartDto.extend({ owner: UserRef, itemCount: NonNegativeInt, unitCount: NonNegativeInt, total: MoneyCents });

export const PaymentInput = z.object({
  method: PaymentMethod, amount: MoneyCents.refine((v) => v > 0, 'El monto debe ser mayor que 0'),
  received: MoneyCents.optional(), reference: z.string().trim().min(1).max(60).optional(),
}).refine((p) => p.received === undefined || (p.method === 'CASH' && p.received >= p.amount),
  { path: ['received'], message: 'El efectivo recibido no alcanza' })
  .refine((p) => p.method !== 'CASH' || p.reference === undefined, { path: ['reference'], message: 'El efectivo no lleva referencia' });
export const CheckoutInput = z.object({
  cashSessionId: Uuid,                     // la caja abierta del dispositivo que cobra
  payments: z.array(PaymentInput).max(3),
  customerName: optionalName(120).optional(),
  verifiedUnits: NonNegativeInt,           // piezas verificadas por escaneo en caja (0 = sin verificar)
}).refine(/* a lo sumo un pago por método */);

export const TicketBranchDto = BranchDto.pick({
  code: true, name: true, legalName: true, taxId: true, address: true, phone: true, logoUrl: true,
  ticketHeader: true, ticketFooterMessage: true, promoQrText: true, promoQrCaption: true, timezone: true, currency: true,
});
export const SaleTicketDto = z.object({
  sale: SaleDto, items: z.array(SaleItemDto), payments: z.array(PaymentDto),
  branch: TicketBranchDto, cashRegister: z.object({ code: z.string(), name: z.string() }),
  seller: UserRef, cashier: UserRef, cancelledBy: UserRef.nullable(),
});
export const SaleListItemDto = z.object({
  id: Uuid, folio: z.string(), createdAt: IsoDateTime, total: MoneyCents, status: SaleStatus,
  customerName: z.string().nullable(), seller: UserRef, cashier: UserRef, methods: z.array(PaymentMethod),
});
export const SaleCancelInput = z.object({ reason: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(300) });
```

`LocateResultDto` es de F7. `CartDto` (con `branchId` y `number`), `CartItemDto`, `SaleDto` (con `cashierId`), `SaleItemDto`, `PaymentDto`, `CashSessionDto`, `CashRegisterDto` y `BranchDto` son de F1. Los tipos se exportan con `z.infer`.

### 5.2 `errors.ts`

| Código | HTTP | Mensaje |
|---|---|---|
| `NO_OPEN_CASH_SESSION` | 409 | "No hay ninguna caja abierta en la sucursal; abre una para empezar a vender." |
| `CASH_SESSION_ALREADY_OPEN` | 409 | "Esta caja ya está abierta." |
| `CASH_SESSION_CLOSED` | 409 | "La caja ya está cerrada." |
| `CASH_SESSION_HAS_OPEN_CARTS` | 409 | "Hay carritos con productos reservados; resuélvelos antes de cerrar la última caja." (`details.carts`) |
| `CART_LIMIT_REACHED` | 409 | "Ya tienes 5 carritos suspendidos; cobra o descarta alguno." |
| `CART_NOT_EDITABLE` | 409 | "El carrito ya se cobró o se descartó." |
| `CART_EMPTY` | 409 | "El carrito está vacío." |
| `VARIANT_INACTIVE` | 409 | "Este producto está desactivado y no se puede vender." |
| `PAYMENT_TOTAL_MISMATCH` | 400 | "Los pagos no cuadran con el total." (`details: { total, paid }`) |
| `SALE_ALREADY_CANCELLED` | 409 | "La venta ya está cancelada." |

---

## 6. Endpoints

Todos bajo `/api/v1/pos`, con tag `pos`, `branchScoped`. Las respuestas de error son `ApiErrorDto`. Una sesión, carrito o venta de otra sucursal → 403 `BRANCH_FORBIDDEN`.

**Caja y sucursal**

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /branch` | `pos.sell` | — | 200 `TicketBranchDto` |
| `GET /lookup` | `pos.sell` | `code` | 200 `LocateResultDto` · 404 |
| `GET /cash-registers` | `pos.sell` | — | 200 `PosRegisterDto[]` (activas, por `code`) |
| `POST /cash-sessions/open` | `pos.session.open` | `OpenSessionInput` | 201 `PosSessionDto` · 400 · 403 · 409 `CASH_SESSION_ALREADY_OPEN` |
| `GET /cash-sessions/:id` | `pos.sell` | — | 200 `PosSessionDto` |
| `GET /cash-sessions/:id/sales` | `pos.sell` | `PaginationQuery` | 200 `paginated(SaleListItemDto)` |
| `POST /cash-sessions/:id/close` | `pos.session.close` | `CloseSessionInput` | 200 `CashSessionSummaryDto` · 409 (`CASH_SESSION_HAS_OPEN_CARTS`, `CASH_SESSION_CLOSED`) |
| `GET /cash-sessions/:id/summary` | `pos.session.close` | — | 200 `CashSessionSummaryDto` · 409 `CONFLICT` (sesión abierta) |

**Carritos**

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /carts` | `pos.sell` | `CartListQuery` | 200 `CartSummaryDto[]` (`ACTIVE` y `SUSPENDED` de la sucursal, por `number`) |
| `POST /carts` | `pos.sell` | `CartCreateInput` | 201 `CartDetailDto` (200 si reutiliza el activo vacío) · 409 (`CART_LIMIT_REACHED`, `NO_OPEN_CASH_SESSION`) |
| `POST /carts/release-all` | `pos.session.close` | `ReleaseCartsInput` | 200 `{ releasedCarts }` |
| `GET /carts/:id` | `pos.sell` | — | 200 `CartDetailDto` |
| `PATCH /carts/:id` | `pos.sell` (+ `pos.discount` si cambia `discount`) | `CartUpdateInput` | 200 `CartDetailDto` · 400 · 403 · 409 |
| `POST /carts/:id/suspend` | `pos.sell` (dueño) | `CartSuspendInput` | 200 `CartDetailDto` · 403 · 409 (`CART_EMPTY`, `CART_LIMIT_REACHED`, `CART_NOT_EDITABLE`) |
| `POST /carts/:id/resume` | `pos.sell` (dueño) | — | 200 `CartDetailDto` · 403 · 409 |
| `POST /carts/:id/discard` | `pos.sell` | `CartDiscardInput` | 200 `CartDetailDto` · 409 |
| `POST /carts/:id/items` | `pos.sell` | `CartItemAddInput` | 201 `CartDetailDto` · 400 · 409 (`STOCK_INSUFFICIENT`, `VARIANT_INACTIVE`, `CART_NOT_EDITABLE`, `NO_OPEN_CASH_SESSION`) |
| `PATCH /carts/:id/items/:itemId` | `pos.sell` (+ `pos.discount` si cambia `discount`) | `CartItemUpdateInput` | 200 `CartDetailDto` · 400 · 403 · 409 |
| `DELETE /carts/:id/items/:itemId` | `pos.sell` | `releaseTo` (query, default `RACK`) | 200 `CartDetailDto` · 404 · 409 |
| `POST /carts/:id/checkout` | `pos.sell` | `CheckoutInput` | 201 `SaleTicketDto` · 400 `PAYMENT_TOTAL_MISMATCH` · 403 · 409 (`CART_EMPTY`, `CART_NOT_EDITABLE`, `CASH_SESSION_CLOSED`) |

**Ventas**

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /sales/:id/ticket` | `pos.sell` | — | 200 `SaleTicketDto` |
| `POST /sales/:id/cancel` | `pos.sale.cancel` | `SaleCancelInput` | 200 `SaleTicketDto` · 400 · 403 · 409 (`SALE_ALREADY_CANCELLED`, `CASH_SESSION_CLOSED`) |

---

## 7. Pantallas (wireframe en texto)

**Inicio del POS**: dos accesos grandes, [Atender] (todos con `pos.sell`) y [Cobrar] (carritos de la sucursal), más "Mi caja" (historial y corte) si el dispositivo tiene caja.

**Atender (`/pos`)**, móvil:

```
┌──────────────────────────────┐
│ Atender · Ana       [≡ Menú] │  ← Carritos de la sucursal · Mi caja · Ajustes del ticket
│ [#12 Señora rojo●][#15 Juan][+]│  ← barra de carritos (míos): activo + suspendidos, con su número
│ Carrito #12  (díselo al cliente para pagar)
│ [ Escanea o escribe un SKU ][📷]
├──────────────────────────────┤
│ [img] Zapato de piel dama    │
│       $899.00                │
│ Talla: [23][24][25●][26✕]    │  ← ✕ = sin disponibles aquí
│ Color: [Negro●][Café]        │
│ 25 Negro · 4 disponibles     │
│  🟦 A-01-01  3   [Agregar]   │
│  ⬜ STG-01-01 1  [Agregar]   │
│ Hay en Sucursal 2 (2) · 55 1234 5678   ← con inventory.other_branches.read
├──────────────────────────────┤
│ Carrito (3 pzas)             │
│  Zapato 25 Negro · A-01-01   │
│   [−] 1 [+]   $899.00   [⋯] │  ← ⋯ = Quitar / Descuento
│  Cinturón · C-01-01          │
│   [−] 1 [+]   $349.00   [⋯] │
├──────────────────────────────┤
│ Total $1,248.00   [Suspender] [Cobrar] │  ← barra fija
└──────────────────────────────┘
```

Sin cajas abiertas en la sucursal, arriba aparece "No hay cajas abiertas" (con [Abrir caja] si tiene `pos.session.open`) y "Agregar" se deshabilita. Si la variante elegida no tiene disponibles aquí, "En otras sucursales" se muestra arriba de las ubicaciones y en negritas. En escritorio, búsqueda y carrito van en dos columnas. [Cobrar] lleva al cobro de ese carrito (y, si el dispositivo no tiene caja, primero a elegirla).

**Quitar** (hoja inferior): "¿Qué hacemos con el producto?" → [Regresar a su ubicación (A-01-01)] · [Enviar a staging]. Bajar la cantidad con [−] muestra la misma hoja.

**Suspender** (diálogo): etiqueta ("Señora vestido rojo") y nombre del cliente, opcionales. Con 5 suspendidos, el botón se deshabilita con "Ya tienes 5 carritos suspendidos".

**Promoción escaneada** (diálogo): "Código de promoción: DESC10" y, si coincide con la de la sucursal, "Muestra este QR al cajero en tu próxima compra". Con `pos.discount`: [Aplicar descuento] (abre el descuento global). [Cerrar].

**Descuento** (diálogo, con `pos.discount`): [Monto | %] · valor · vista del total nuevo · [Aplicar] · [Quitar descuento].

**Carritos de la sucursal (`/pos/carts`)**: arriba, [Buscar # ___] (teclear "12" abre ese carrito); tarjetas con número grande ("#12"), vendedor, etiqueta o cliente, piezas y total; tocar una abre su detalle con [Cobrar] y [Descartar].

**Caja para cobrar (`/pos/register`)**

```
  ¿Desde qué caja cobras?
  ┌──────────────────────────────────┐
  │ C1 · Caja 1   Abierta por Luis 9:02 │ [Cobrar en esta caja]
  │ C2 · Caja 2   Cerrada                │ [Abrir]   ← con pos.session.open
  └──────────────────────────────────┘
```

"Abrir" pide el fondo inicial (teclado numérico) y confirma. La caja elegida se recuerda en el dispositivo.

**Cobro (`/pos/checkout/:cartId`)**

```
  Cobrando en Caja 1 · Carrito #12 de Ana   [Cambiar caja]
  Verificar piezas (opcional)  [ Escanea las piezas ][📷]
   ✔ Zapato 25 Negro      1 de 1
   ◻ Cinturón             0 de 1
   1 de 2 piezas verificadas
  Total a cobrar       $1,248.00
  [Efectivo] [Tarjeta] [Transferencia]   ← se pueden combinar
  Efectivo   [$1,300.00]  (teclado numérico, atajos $1,250 · $1,300 · $1,500)
  Tarjeta    [$0.00]  Ref. [____]
  Pagado $1,300.00 · Cambio $52.00
  Cliente (opcional) [__________]
  [ Confirmar cobro ]   ← activo solo si lo pagado cuadra; si faltan piezas por verificar, pide confirmar
```

**Ticket**: vista previa (80 o 58 mm) con [Imprimir] y [Listo]; con impresión automática se abre el diálogo de impresión directo. "Ajustes del ticket" (en el menú) cambia, en este dispositivo, la impresión automática y el ancho.

**Mi caja · Historial (`/pos/sales`)**: ventas cobradas en la caja del dispositivo: folio, hora, total, vendedor, métodos y estado; [Reimprimir]; con `pos.sale.cancel`, [Cancelar venta] → confirmación con motivo obligatorio.

**Mi caja · Corte (`/pos/close`)**

```
  Paso 1 · Cuenta el efectivo de la caja
  Efectivo contado [$_______]        ← no se muestra el esperado
  [ Cerrar caja ]
  ── si es la última caja abierta y hay carritos pendientes ──
  ⚠ 2 carritos con productos reservados: Juan (3 pzas), Ana (1 pza)
  [Regresar todo a su ubicación] [Enviar todo a staging]

  Paso 2 · Resultado
  Fondo $500.00 · Ventas 12 ($8,450.00) · Canceladas 1 ($349.00)
  Efectivo $5,200.00 · Tarjeta $2,750.00 · Transferencia $500.00
  Esperado $5,700.00 · Contado $5,680.00 · Diferencia −$20.00
  [Imprimir corte]
```

El corte impreso (80 mm) lleva caja, quién abrió y cerró y cuándo, fondo, ventas, canceladas, desglose por método, esperado, contado y diferencia.

---

## 8. Reglas y casos borde

1. **Sin cajas abiertas en la sucursal** no se puede crear carrito ni agregar productos (`NO_OPEN_CASH_SESSION`); sí se pueden quitar productos o descartar carritos para liberar reservas.
2. **Número de carrito:** el menor libre entre los abiertos de la sucursal; se reutiliza después de cobrar o descartar, así que "#12" de la mañana y "#12" de la tarde pueden ser carritos distintos (nunca dos abiertos a la vez).
3. **Verificación en caja:** opcional; una pieza que no está en el carrito solo avisa (el cajero la agrega o la deja); cobrar con piezas sin verificar pide confirmación y queda en el audit `pos.checkout.unverified`.
4. **Cobrar exige una caja abierta en el dispositivo:** la venta y su dinero quedan en esa caja, sin importar quién armó el carrito. Así cada corte cuadra con el efectivo de su cajón.
5. **Última unidad:** dos vendedores la agregan a la vez; uno la reserva y el otro recibe `STOCK_INSUFFICIENT`.
6. **Sexto carrito suspendido** de un vendedor → 409 `CART_LIMIT_REACHED`; otro vendedor sigue pudiendo suspender.
7. **Carrito cobrado o descartado:** cualquier cambio posterior → 409 `CART_NOT_EDITABLE`. Dos cajeros cobran el mismo carrito: uno cobra y el otro recibe ese error.
8. **Precio cambiado** después de agregar: el carrito conserva el precio con que se agregó.
9. **Producto desactivado** después de agregarlo: la partida se puede cobrar (ya está reservada); no se pueden agregar más (`VARIANT_INACTIVE`).
10. **Descuento sin permiso** → 403. Descuento mayor que el importe → 400. Al bajar cantidades, los descuentos se recortan para no superar el nuevo importe.
11. **Pagos que no cuadran** → 400 `PAYMENT_TOTAL_MISMATCH`; el efectivo es el único que da cambio; no se acepta más de un pago por método.
12. **Total 0** (descuento total) → se cobra sin pagos.
13. **Folios** consecutivos por sucursal y sin duplicados, también con cobros simultáneos en cajas distintas; un cobro fallido no consume folio (la transacción se revierte).
14. **Cancelación:** solo total, con motivo y `pos.sale.cancel`, mientras la caja donde se cobró siga abierta; el stock va a staging y su efectivo deja de contar en el esperado de esa caja.
15. **Cerrar una caja** con otra caja abierta: no se fija en los carritos (siguen vivos para cobrarse en la otra). **Cerrar la última**: con carritos pendientes → 409 con la lista; "Regresar todo" o "Enviar todo a staging" los resuelve y luego se cierra.
16. **Corte ciego:** el esperado no se ve antes de capturar lo contado; la diferencia puede ser negativa.
17. **Caja cerrada desde otro dispositivo:** el siguiente cobro recibe `CASH_SESSION_CLOSED` y la UI pide elegir otra caja; el carrito no se pierde.
18. **Reservas visibles en el almacén:** las unidades en carritos aparecen como "en piso" en el mapa y en Buscar de F7.
19. **Venta o carrito de otra sucursal** → 403 `BRANCH_FORBIDDEN`.
20. **Cambio de IVA en Ajustes:** aplica al siguiente cobro (incluso de carritos ya armados); las ventas guardadas conservan su copia.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Verificar los cambios de F1.**
  - `Sale.cashierId`, `Cart.branchId`, `Cart.number`, `cart_one_active_per_user_branch` y `cart_number_open_per_branch` ya existen: los implementa F1, que los incluye en su spec (§2). F8 no toca `schema.prisma` ni migraciones.
  - *Verificable:* F1 T15 (paridad de `CartDto` y `SaleDto`) y T18 (índice nuevo) en verde.
- [ ] **2. Contratos.**
  - `shared/pos.ts` (`computeSaleTotals`, `computeChange`, `formatFolio`, esquemas y DTOs) y los 10 códigos de error (también en la API). Tests **T1–T4**.
  - *Verificable:* T1–T4 en verde.
- [ ] **3. API: caja.**
  - `sessions.service.ts` y `sessions.routes.ts` (cajas del POS, abrir, detalle, historial, cerrar y resumen); `GET /pos/branch`; registrar en `app.ts`. Tests **T5–T7** y **T21**.
  - *Verificable:* T5–T7 y T21 en verde.
- [ ] **4. API: carritos y partidas.**
  - `carts.service.ts` y `carts.routes.ts` (listar, crear, liberar todos, detalle, editar, suspender, retomar, descartar, partidas y descuentos). Tests **T8–T13**.
  - *Verificable:* T8–T13 en verde.
- [ ] **5. API: búsqueda.**
  - `GET /pos/lookup` sobre `inventory.queries.locate()`. Test **T20**.
  - *Verificable:* T20 en verde.
- [ ] **6. API: cobro, ticket, historial y cancelación.**
  - `checkout.service.ts`, `sales.service.ts` y `sales.routes.ts`. Tests **T14–T19** y **T22**.
  - *Verificable:* T14–T19 y T22 en verde.
- [ ] **7. Vista previa de Ajustes.**
  - `previewTotals` delega en `computeSaleTotals` (regresión declarada de F5).
  - *Verificable:* F5 T22–T23 en verde.
- [ ] **8. UI: caja y Atender.**
  - `PosHomePage`, `PosRegisterPage`, `PosSalePage` (búsqueda, selector de talla y color, otras sucursales, promoción), `CartPanel`, `CartBar` y los guards. Tests **T23–T28**.
  - *Verificable:* T23–T28 en verde.
- [ ] **9. UI: carritos de la sucursal, cobro y ticket.**
  - `BranchCartsPage` (con búsqueda por número), `CheckoutPage` (con verificación por escaneo), `SaleTicket`, impresión automática y "Ajustes del ticket". Tests **T29–T32** y **T36**.
  - *Verificable:* T29–T32 y T36 en verde.
- [ ] **10. UI: historial, cancelación y corte.**
  - `SessionSalesPage`, `CancelSaleDialog`, `CloseSessionPage` y `CashCloseTicket`. Tests **T33–T35**.
  - *Verificable:* T33–T35 en verde.
- [ ] **11. README y cierre.**
  - En el README: abrir caja, "Atender" con varios vendedores, cobro desde cualquier caja abierta, impresión del ticket (impresora del sistema, 80 mm, márgenes en 0), cancelación y corte.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales (§11); registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 36)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (`S1` y `S2`, cada una con `C1` y `C2`) más los datos de cada test (catálogo, racks y stock creados con los helpers; `InventoryService` para el stock inicial). Los de `web` usan Jest + RTL con `fetch` simulado.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `pos.test.ts` | `computeSaleTotals` (`it.each`, 1600 bp): líneas 89900 y 34900 con IVA incluido → total 124800 e IVA 17214; sin IVA → IVA 19968 y total 144768; con descuento de partida 10000 y global 4800, IVA incluido → `discountTotal` 14800, total 110000 e IVA 15172; con 0 bp → IVA 0; el resultado cumple `total = subtotal − discountTotal + (incluido ? 0 : IVA)`. Global mayor que las partidas, descuento de partida mayor que su importe o un monto decimal → `RangeError`. |
| T2 | `shared` · `pos.test.ts` | `PaymentInput`/`CheckoutInput`: sin `cashSessionId` o sin `verifiedUnits` → error; efectivo con `received` menor → error en `received`; `received` en tarjeta → error; `reference` en efectivo → error; dos pagos del mismo método o 4 pagos → error; monto 0 → error; pagos vacíos válidos. `computeChange(130000, 124800)` → 5200 y con `received` menor → `RangeError`. |
| T3 | `shared` · `pos.test.ts` | `CartUpdateInput` estricto y con ≥ 1 campo; `CartItemUpdateInput` sin cantidad ni descuento → error y `releaseTo` por defecto `RACK`; `"  "` en etiqueta → `null`; `SaleCancelInput` con 2 caracteres → error; `OpenSessionInput` con fondo negativo → error. `formatFolio('S1', 123)` → `S1-000123` y `formatFolio('S1', 1234567)` → `S1-1234567`. |
| T4 | `shared` · `errors.test.ts` + `pos.test.ts` | Los 10 códigos nuevos existen. `PAYMENT_METHOD_LABELS` cubre los 3 métodos. Las fixtures de `CartDetailDto`, `SaleTicketDto` (normal y cancelada), `CashSessionSummaryDto` (diferencia negativa) y `PosRegisterDto` (con y sin sesión) son válidas. |
| T5 | `int` · `pos-sessions.int.test.ts` | `GET /pos/cash-registers` → `C1` y `C2` de la sucursal actual con `openSession` null; abrir `C1` → 201 y `AuditLog` `pos.session.open`; ahora `C1` trae `openSession` con quien abrió; abrir `C1` otra vez → 409 `CASH_SESSION_ALREADY_OPEN`; abrir una caja de `S2` con la sucursal actual `S1` → 403 `BRANCH_FORBIDDEN`; un usuario sin `pos.session.open` → 403. |
| T6 | `int` · `pos-sessions.int.test.ts` | Corte de `C1`: fondo 50000, una venta en efectivo de 124800 (recibido 130000), una mixta (efectivo 20000 + tarjeta 30000) y una venta en efectivo cancelada → esperado 50000 + 124800 + 20000; `difference` = contado − esperado (también negativa); `byMethod` trae los 3 métodos; `cancelledCount` 1; la sesión queda `CLOSED` con `closedById`; `AuditLog` `pos.session.close`; cerrar otra vez → 409 `CASH_SESSION_CLOSED`; `GET …/summary` de una sesión abierta → 409 y de una cerrada → 200; sin `pos.session.close` → 403. |
| T7 | `int` · `pos-sessions.int.test.ts` | Con `C1` y `C2` abiertas y carritos de dos vendedores con partidas (uno suspendido) y uno vacío: cerrar `C1` → 200 y los carritos siguen igual; cerrar `C2` (la última) → 409 `CASH_SESSION_HAS_OPEN_CARTS` con los 2 carritos; `POST /carts/release-all` `RACK` → ambos `DISCARDED`, movimientos `RETURN_TO_RACK`, `reservedQty` en 0 y `AuditLog` `pos.carts.release_all`; luego cerrar `C2` → 200 y el carrito vacío queda `DISCARDED`. En otro caso, `release-all` `STAGING` → movimientos `TO_STAGING` y las unidades en `STG-01-01`. |
| T8 | `int` · `pos-carts.int.test.ts` | Sin cajas abiertas en la sucursal, crear carrito → 409 `NO_OPEN_CASH_SESSION`; con una abierta → `ACTIVE` con `branchId` y `number` 1; los siguientes de la sucursal (de cualquier vendedor) reciben 2, 3…; tras cobrar o descartar el #1, el siguiente carrito nuevo recibe 1; suspender y retomar conservan el número; crear otro teniendo el activo vacío → 200 con el mismo id; con partidas → el anterior pasa a `SUSPENDED` y el nuevo es `ACTIVE`; con 5 suspendidos, crear otro con partidas en el activo → 409 `CART_LIMIT_REACHED`; otro vendedor sí puede suspender; un segundo `ACTIVE` del mismo usuario en la sucursal insertado directo en BD → falla por `cart_one_active_per_user_branch`. |
| T9 | `int` · `pos-carts.int.test.ts` | Suspender guarda etiqueta y cliente y conserva las reservas (`reservedQty` igual); suspender un carrito vacío → 409 `CART_EMPTY`; retomar (dueño) → el retomado `ACTIVE` y el activo con partidas `SUSPENDED` (o `DISCARDED` si estaba vacío); suspender o retomar el carrito de otro vendedor → 403. |
| T10 | `int` · `pos-cart-items.int.test.ts` | Agregar → movimiento `PICK` con `reference` `CART`, `reservedQty` +n y `unitPrice` = precio efectivo (con `priceOverride`); la misma variante y rack se suma a la partida; desde staging → OK; más que lo disponible → 409 `STOCK_INSUFFICIENT`; variante desactivada → 409 `VARIANT_INACTIVE`; rack de `S2` → 400 en `sourceRackId`; sin cajas abiertas → 409 `NO_OPEN_CASH_SESSION`; tras cambiar el precio del producto, la partida conserva el suyo. |
| T11 | `int` · `pos-cart-items.int.test.ts` | Subir cantidad → `PICK` de la diferencia; bajar con `RACK` → `RETURN_TO_RACK`; bajar con `STAGING` → `TO_STAGING` y staging suma; quitar con `STAGING` → la partida desaparece y la unidad está en staging; quitar y descartar funcionan aunque no haya cajas abiertas; partida de otro carrito → 404. |
| T12 | `int` · `pos-cart-items.int.test.ts` | Descuento de partida y global con `pos.discount` → totales correctos (`computeSaleTotals`); sin `pos.discount` (Vendedor) → 403 con `details.permission`; descuento mayor que el importe → 400; bajar la cantidad recorta el descuento de la partida y el global para no superar el nuevo importe. |
| T13 | `int` · `pos-carts.int.test.ts` | `GET /carts?scope=all` lista los carritos `ACTIVE` y `SUSPENDED` de todos los vendedores de la sucursal con su dueño y total; `scope=mine` solo los propios; `number=2` devuelve solo ese carrito; otro usuario con `pos.sell` ve el detalle de un carrito ajeno, le cambia una cantidad y lo descarta; descartar con `RACK` libera todo y deja `DISCARDED`; cualquier cambio posterior → 409 `CART_NOT_EDITABLE`; un carrito de otra sucursal → 403 `BRANCH_FORBIDDEN`. |
| T14 | `int` · `pos-checkout.int.test.ts` | Vendedor arma y cajero cobra en `C1` con efectivo: 201 `SaleTicketDto`; folio `S1-000001` (el siguiente `S1-000002`; el primero de `S2` es `S2-000001`); `cashSessionId` y `cashRegisterId` de `C1`, `sellerId` = vendedor y `cashierId` = cajero; *snapshots* de SKU, nombre y variante; totales de `computeSaleTotals` y copia de `taxRateBp`/`pricesIncludeTax`; `Payment` con `received` y `change`; `quantity` y `reservedQty` bajan exactamente en el rack de origen; movimientos `SALE` con `reference` de la venta; carrito `CHECKED_OUT`; `branch` del ticket con los datos de la sucursal, aunque el vendedor no tenga `settings.branch`. |
| T15 | `int` · `pos-checkout.int.test.ts` | Pagos que no cuadran → 400 `PAYMENT_TOTAL_MISMATCH` con `total` y `paid`, sin venta ni folio consumido; pago mixto (efectivo + tarjeta con referencia) → 201; carrito vacío → 409 `CART_EMPTY`; carrito ya cobrado → 409 `CART_NOT_EDITABLE`; `cashSessionId` cerrada → 409 `CASH_SESSION_CLOSED`; `cashSessionId` de `S2` → 403 `BRANCH_FORBIDDEN`; total 0 por descuento → 201 sin pagos; un carrito suspendido se cobra directo; el mismo vendedor cobra su propio carrito (`sellerId` = `cashierId`); `verifiedUnits` menor que las unidades → 201 y `AuditLog` `pos.checkout.unverified` con `verifiedUnits` y `totalUnits`; igual a las unidades → sin ese audit; mayor → 400 en `verifiedUnits`. |
| T16 | `int` · `pos-checkout.int.test.ts` | Sucursal con `pricesIncludeTax: false` y descuentos de partida y global: el IVA se suma al total y la venta pasa `sale_total_check`; cambiar el IVA de la sucursal entre armar y cobrar → se usa el valor al cobrar. |
| T17 | `int` · `pos-checkout.int.test.ts` | Cobro en otra caja: con `C1` y `C2` abiertas, un vendedor arma dos carritos; uno se cobra en `C1` y otro en `C2`, ambos en efectivo → cada venta queda en la caja que cobró; el corte de `C1` espera solo su venta y el de `C2` solo la suya (los dos cuadran con lo cobrado en cada una); el historial de cada caja muestra solo su venta. |
| T18 | `int` · `pos-sales.int.test.ts` | `GET /sales/:id/ticket` → `SaleTicketDto`; de otra sucursal → 403; `GET /cash-sessions/:id/sales`: un Vendedor sin `reports.sales.all_users` ve solo las ventas donde es vendedor o cajero; un Gerente las ve todas; orden descendente y paginación. |
| T19 | `int` · `pos-sales.int.test.ts` | Cancelar (Gerente) con motivo → 200; la venta queda `CANCELLED` con `cancelledAt`, `cancelledById` y `cancelReason`; movimientos `SALE_CANCEL` hacia `STG-01-01` del almacén de cada partida; `AuditLog` `pos.sale.cancel`; cancelar otra vez → 409 `SALE_ALREADY_CANCELLED`; motivo vacío → 400; Vendedor → 403; con la caja donde se cobró ya cerrada → 409 `CASH_SESSION_CLOSED`. |
| T20 | `int` · `pos-lookup.int.test.ts` | `GET /pos/lookup` por SKU de variante y por SKU padre → `LocateResultDto` con precio efectivo y ubicaciones; un usuario solo con `pos.sell` (sin `warehouse.read`) → 200; tras agregar 1 unidad al carrito, la ubicación muestra 1 reservada y F7 (`GET /racks/:id`) marca la variante "en piso"; con `inventory.other_branches.read` trae `S2` con sus disponibles y sin él `otherBranches: null`. |
| T21 | `int` · `pos-access.int.test.ts` | `GET /pos/branch` → `TicketBranchDto` para un Vendedor (sin `settings.branch`); sin `pos.sell` → 403 en las rutas de `pos.sell`; `/api/docs/json` agrupa las 22 rutas bajo el tag `pos` con `security`. |
| T22 | `int` · `pos-concurrency.int.test.ts` | Dos vendedores agregan en paralelo la última unidad de un rack → un 201 y un 409 `STOCK_INSUFFICIENT`, `reservedQty` final 1; 10 cobros en paralelo repartidos en `C1` y `C2` de `S1` → folios `S1-000001`…`S1-000010` sin huecos ni duplicados; dos cobros en paralelo del mismo carrito desde cajas distintas → un 201 y un 409 `CART_NOT_EDITABLE`; dos aperturas en paralelo de `C1` → un 201 y un 409 `CASH_SESSION_ALREADY_OPEN`; 10 vendedores crean carrito en paralelo → números 1…10 sin repetir; con un carrito pendiente, cerrar `C1` y `C2` en paralelo → al menos uno recibe 409 `CASH_SESSION_HAS_OPEN_CARTS` y nunca quedan las dos cerradas con el carrito pendiente. |
| T23 | `web` · `PosHomePage.test.tsx` | Muestra [Atender] y [Cobrar]; "Mi caja" aparece solo si el dispositivo tiene una caja abierta guardada; sin `pos.sell`, el módulo no aparece en el menú. |
| T24 | `web` · `PosRegisterPage.test.tsx` | Lista las cajas: la abierta con "Cobrar en esta caja" (guarda `wm.pos.register.<branchId>` y vuelve a `next`); la cerrada con "Abrir" solo con `pos.session.open`; abrir envía `OpenSessionInput` con el fondo en centavos; un 409 `CASH_SESSION_ALREADY_OPEN` refresca la lista. Ir a cobrar sin caja guardada, o con su sesión cerrada, lleva a `/pos/register?next=`; un 409 `CASH_SESSION_CLOSED` al cobrar muestra "La caja se cerró" y lleva a elegir otra sin perder el carrito. |
| T25 | `web` · `PosSalePage.test.tsx` | "Atender" no pide caja; un escaneo llama a `/pos/lookup`; el selector muestra tallas y colores y marca los que no tienen disponibles; elegir talla y color muestra las ubicaciones; "Agregar" desde `A-01-01` envía `CartItemAddInput`; un SKU padre pide elegir; una variante desactivada no se puede agregar; sin cajas abiertas en la sucursal muestra "No hay cajas abiertas" y deshabilita "Agregar". |
| T26 | `web` · `PosSalePage.test.tsx` | Con `otherBranches` muestra "Hay en Sucursal 2 (2) · 55 1234 5678" (arriba y resaltado si aquí no hay disponibles); con `otherBranches: null` no muestra nada. Un escaneo `promo` abre el aviso con el texto, con la descripción si coincide con `promoQrText`; "Aplicar descuento" aparece solo con `pos.discount` y abre el descuento global. |
| T27 | `web` · `CartPanel.test.tsx` | Muestra las partidas con su ubicación y el total fijo; [+] envía la cantidad nueva; [−] y "Quitar" abren la hoja "Regresar a su ubicación (A-01-01)" / "Enviar a staging" y envían `releaseTo`; "Descuento" aparece solo con `pos.discount`; 10 % sobre $899.00 envía `discount: 8990`. |
| T28 | `web` · `CartBar.test.tsx` | Chips del activo y los suspendidos con su número ("#12") y etiqueta o cliente; el activo muestra "Carrito #12" en grande; tocar uno llama a `resume`; "Nuevo carrito" llama a `POST /carts`; "Suspender" pide etiqueta y cliente; con 5 suspendidos el botón se deshabilita con el aviso. |
| T29 | `web` · `BranchCartsPage.test.tsx` | Pide `scope=all`, lista los carritos de la sucursal con su número, vendedor, etiqueta, piezas y total, y se refresca cada 15 s; teclear "12" en "Buscar #" pide `number=12` y abre ese carrito (sin resultado: "No hay un carrito abierto con ese número"); tocar uno abre su detalle con "Cobrar" y "Descartar". |
| T30 | `web` · `CheckoutPage.test.tsx` | Muestra "Cobrando en Caja 1", el número y el dueño del carrito; elegir efectivo y teclear 1300 → "Cambio $52.00"; combinar efectivo y tarjeta; "Confirmar cobro" deshabilitado hasta que lo pagado cuadre; envía `CheckoutInput` con el `cashSessionId` del dispositivo, `received`, `reference` y `verifiedUnits`; un 400 `PAYMENT_TOTAL_MISMATCH` muestra el mensaje sin salir. |
| T31 | `web` · `SaleTicket.test.tsx` | Con un `SaleTicketDto`: encabezado y pie de F5 con los datos de la sucursal, folio, fecha en la zona de la sucursal, caja, "Le atendió", "Cajero", cliente, partidas con descuento, totales con IVA incluido ("IVA incluido") y sin incluir ("IVA 16 %"), pagos con recibido y cambio, y el QR de promoción; una venta cancelada muestra "*** CANCELADA ***" con el motivo; el ancho cambia entre 80 y 58 mm. |
| T32 | `web` · `CheckoutPage.test.tsx` | Tras cobrar, con impresión automática (por defecto) se monta `PrintLayout` `ticket-80` y se llama a `window.print`; con la opción desactivada en "Ajustes del ticket" se muestra la vista previa con "Imprimir"; el ancho de 58 mm usa `ticket-58`; si `localStorage` lanza error, se imprime automático a 80 mm. |
| T33 | `web` · `SessionSalesPage.test.tsx` | Lista las ventas cobradas en la caja del dispositivo con folio, hora, total, vendedor, métodos y estado; "Reimprimir" pide el ticket e imprime; "Cancelar venta" aparece solo con `pos.sale.cancel`, exige el motivo y envía `SaleCancelInput`; la venta cancelada muestra su estado. |
| T34 | `web` · `CloseSessionPage.test.tsx` | El paso 1 solo pide el efectivo contado y no muestra el esperado; un 409 `CASH_SESSION_HAS_OPEN_CARTS` lista los carritos y ofrece "Regresar todo a su ubicación" y "Enviar todo a staging" (envían `ReleaseCartsInput` a `/carts/release-all`); después cierra y muestra esperado, contado, diferencia (negativa en rojo) y el desglose. |
| T35 | `web` · `CashCloseTicket.test.tsx` | "Imprimir corte" monta `PrintLayout` `ticket-80` con caja, apertura y cierre (usuario y hora), fondo, ventas, canceladas, desglose por método, esperado, contado y diferencia; después del corte se olvida la caja guardada en el dispositivo. |
| T36 | `web` · `CheckoutVerification.test.tsx` | Verificación en caja: escanear el SKU (o el código de barras) de una partida suma 1 ("1 de 2 piezas verificadas") y la palomea al completar su cantidad; escanear una pieza de más avisa "Ya verificaste todas las piezas de esta partida"; una que no está en el carrito avisa "Este producto no está en el carrito" sin cambiarlo; un SKU padre variable pide la etiqueta de la variante; con piezas sin verificar, "Confirmar cobro" abre "Faltan N piezas por verificar. ¿Cobrar de todos modos?" y solo cobra al aceptar; con todo verificado cobra directo. |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F7 siguen en verde (F5 T22–T23 con `previewTotals` delegado, §1).

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | No se puede vender sin una caja abierta. | T8, T10, T15, T24, T25 |
| CA2 | Un vendedor no puede suspender un sexto carrito. | T8, T28 |
| CA3 | Las reservas se reflejan como "en piso" en el mapa del almacén. | T20 |
| CA4 | Al vender, el stock baja exactamente lo vendido, del rack de origen, y el kardex lo refleja. | T14 |
| CA5 | Dos vendedores no pueden reservar la misma última unidad; los folios no se duplican. | T22 |
| CA6 | El ticket muestra los datos configurados en Ajustes y se imprime correctamente a 80 mm. | T14, T31 + verificación manual en la Epson TM-T20III (logo, textos, partidas, totales y QR legibles, sin cortes) |
| CA7 | Una venta cancelada deja su stock en staging, el kardex lo refleja y su efectivo no cuenta en el corte. No se puede cancelar si la caja ya está cerrada. | T6, T19 |
| CA8 | El vendedor sabe si un producto tiene existencias en otra sucursal. | T20, T26 |
| CA9 | Cualquier cajero (o el mismo vendedor) cobra cualquier carrito de la sucursal, y el dinero queda en la caja que cobra: los cortes cuadran. | T15, T17 |
| CA10 | El corte es ciego y la última caja no se cierra con carritos pendientes hasta resolverlos. | T6, T7, T34 |
| CA11 | El flujo completo (atender con dos vendedores en celulares, cobrar en la PC con el lector y la impresora, imprimir) funciona en dispositivos reales. | Verificación manual (dispositivos, fecha y responsable en §12) |
| CA12 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F7. | Salida de los comandos en §12 |
| CA13 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |
| CA14 | El cajero encuentra el carrito por su número corto y puede verificar las piezas escaneándolas; cobrar sin verificar todo pide confirmación y queda en el audit. | T8, T13, T15, T29, T36 |

El criterio de F5 "los cambios se reflejan después en los tickets reales" queda cubierto por T14 y T31.

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-05 | Modelo "vendedor arma, caja cobra": cualquiera con `pos.sell` (el cajero o el mismo vendedor) ve y cobra los carritos de cualquier vendedor de la sucursal. | Usuario (chat); plan §4.2 y §8 F8 actualizados |
| 2026-10-05 | La venta y su dinero quedan en la **caja que cobra** (el cobro lleva `cashSessionId`), para que los cortes cuadren. | Usuario (chat); plan §8 F8 actualizado |
| 2026-10-05 | Botón **"Atender"**: el vendedor arma el carrito sin elegir caja; el carrito es de la sucursal (`Cart.branchId` en lugar de `cashSessionId`). Para atender basta con una caja abierta en la sucursal (`NO_OPEN_CASH_SESSION`). | Usuario (chat), por recomendación del agente; F1 §4.6 y §5.2 y plan §4.1, §4.2 y §8 F8 actualizados |
| 2026-10-05 | Máximo 5 carritos suspendidos por vendedor en la sucursal, más un carrito activo por vendedor. | Usuario (chat); plan §4.2 y §8 F8 actualizados; F1 §5.2 (índice) |
| 2026-10-05 | `Sale.sellerId` = quien armó el carrito; nuevo `Sale.cashierId` = quien cobró. El ticket muestra "Le atendió" y "Cajero". | Usuario (chat); F1 §4.6 y plan §4.1, §4.2 actualizados |
| 2026-10-05 | Corte ciego: primero el efectivo contado; después esperado y diferencia. | Usuario (chat); plan §8 F8 actualizado |
| 2026-10-05 | IVA calculado una vez sobre el total después de descuentos (`computeSaleTotals`); reemplaza el cálculo provisional de F5. | Usuario (chat); plan §8 F8 actualizado |
| 2026-10-05 | Impresión del ticket automática al cobrar, desactivable por dispositivo (con vista previa y "Imprimir"). | Usuario (chat); plan §8 F8 actualizado |
| 2026-10-05 | Los carritos pendientes solo bloquean el cierre de la **última** caja abierta de la sucursal; quien cierra puede regresarlos todos a su ubicación o a staging. | Usuario (chat); plan §4.3 y §8 F8 actualizados |
| 2026-10-05 | El ticket lleva los datos **actuales** de la sucursal en `SaleTicketDto` (`TicketBranchDto`), y `GET /pos/branch` los da al POS; así el vendedor imprime sin `settings.branch`. Resuelve el pendiente de F5. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | Solo el dueño suspende o retoma su carrito; editar, descartar y cobrar lo puede cualquiera con `pos.sell`. Crear un carrito suspende el activo con partidas o reutiliza el vacío. Quitar y descartar no exigen caja abierta. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | El precio de la partida se fija al agregarla; se suma a la partida existente si coinciden variante y rack; staging se acepta como origen. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | Descuentos en centavos con recorte automático al bajar cantidades; de 1 a 3 pagos, uno por método; solo el efectivo da cambio; total 0 sin pagos. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | `GET /pos/lookup` con `pos.sell` reutiliza la consulta `locate` de F7, para no exigir `warehouse.read` en el POS. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | En el historial de la caja, sin `reports.sales.all_users` se ven solo las ventas donde el usuario es vendedor o cajero. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | El resumen del corte solo se consulta con la sesión cerrada; cualquier usuario con `pos.session.close` cierra, no solo quien abrió. Cierre, apertura y alta de carritos se serializan con un bloqueo sobre la sucursal. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | 10 códigos de error nuevos; audit de apertura, cierre, liberación de carritos y cancelación; lista de carritos refrescada cada 15 s. | Propuesta del agente; revisar al aprobar |
| 2026-10-05 | Verificación en caja **opcional pero visible**: el cajero escanea las piezas y cada lectura palomea una partida; una pieza ajena solo avisa; cobrar con piezas sin verificar pide confirmación y queda en el audit `pos.checkout.unverified`. | Usuario (chat); plan §8 F8 actualizado |
| 2026-10-05 | Número corto de carrito ("Carrito #12"): el menor libre 1–999 entre los carritos abiertos de la sucursal, visible en el celular del vendedor y buscable en caja (`Cart.number`). | Usuario (chat), por sugerencia del agente; F1 §4.6, §5.1 y §5.2 y plan §4.2 actualizados |
| 2026-10-05 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
