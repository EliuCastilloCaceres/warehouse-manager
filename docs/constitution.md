# Constitución del agente — warehouse-manager (MVP)

Este documento es **vinculante**. Si un pedido del usuario, una spec futura, el plan o un hábito de “hacer extra” contradice esta constitución, gana la constitución.  
El agente **pregunta y espera respuesta** antes de continuar. No asume, no elige en silencio, no “resuelve después”.

---

## 0. Vocabulario

| Término | Significado |
|---|---|
| **Plan** | `docs/plan/plan.md`. Define qué es el MVP, stack, modelo, fases F0–F10 y lo que queda fuera. |
| **Spec** | Un archivo `docs/specs/fase-XX-*.md`. Es el **único** documento que autoriza código en esa fase. |
| **Spec activa** | La spec cuyo estado es `EN_PROGRESO`. Solo puede haber **una**. |
| **Código autorizado** | Archivos, módulos, endpoints, pantallas, migraciones, seeds y tests que la spec activa lista explícitamente (o que son dependencia estrictamente necesaria de un TODO de esa spec). |
| **Código no autorizado** | Cualquier implementación de otra fase, del roadmap (§11), de “por si acaso”, de refactor no pedido, o de alcance no escrito en la spec activa. |
| **Cierre de spec** | La spec activa cumple el Definition of Done de §4. Solo entonces puede pasar a `COMPLETA`. |
| **Ambigüedad** | Cualquier punto en el que dos lecturas razonables llevan a código distinto: campo, endpoint, UX, error, permiso, test, stack, o pregunta abierta del plan §13. |

Estados de spec: `BORRADOR` → `LISTA` → `EN_PROGRESO` → `BLOQUEADA` → `COMPLETA`.  
`BLOQUEADA` = hay pregunta sin respuesta; **prohibido** escribir código de implementación hasta desbloquear.

---

## 1. Principios no negociables

### P1. Una spec a la vez
- El grafo de fases del plan §8 es obligatorio: F0 → F1 → F2 y F3 (en paralelo **solo** si ambas specs están `LISTA` y el usuario lo autoriza explícitamente; por defecto **secuencial**: F2 luego F3).
- **Prohibido** abrir, implementar o “adelantar” TODOs de F(n+1) mientras F(n) no esté `COMPLETA`.
- **Prohibido** mezclar entregables de dos specs en el mismo commit/sesión de implementación, salvo un fix de regresión en una spec ya `COMPLETA` (y entonces el alcance del fix se declara y se acota).

### P2. Solo código autorizado por la spec activa
El agente **no ejecuta ni escribe** código que la spec activa no autorice.

Incluye, sin excepción:
- endpoints, tablas, campos, seeds, UI, PWA, Docker, CI, librerías;
- “puntos de extensión” del plan §11 (proveedores, WooCommerce, transferencias, ABC, ESC/POS, offline, CFDI, alta de sucursales, etc.): **diseño permitido solo como comentario/TODO en docs**, nunca como tablas, rutas ni pantallas hasta una spec que los autorice;
- features “pequeñas” no listadas (export xlsx de reportes si la spec F9 lo marca opcional y no está en los TODOs activos, etc.).

Si para completar un TODO hace falta un archivo no mencionado, el agente **pregunta** (“¿autorizo crear X porque Y?”) y espera. No lo crea “de paso”.

**Excepción estrecha:** scaffolding mínimo exigido por el stack de la spec (p. ej. un plugin de Fastify que F2 lista). Si no está en la spec, no aplica la excepción.

### P3. Preguntar siempre ante ambigüedad
Ante duda, el agente:
1. Se detiene.
2. Formula **una pregunta concreta** (opciones A/B cuando sea posible) citando plan/spec.
3. Marca la spec `BLOQUEADA` si ya está `EN_PROGRESO`.
4. **No** implementa, no elige el default del plan si el plan dice “depende del cliente”, y no rellena huecos con “lo típico”.

En particular, las preguntas del plan **§13** bloquean el **cierre de F1**. No se cierra el modelo de datos con supuestos sobre moneda, IVA, descuentos, capacidad forzada, códigos de ubicación, CFDI, cancelaciones, etc. Si el usuario no ha respondido, se pregunta; no se inventa.

### P4. Cero salto de tests
No se declara una spec `COMPLETA` si falta **cualquier** test que la propia spec liste en “Tests requeridos”, o si algún criterio de aceptación no tiene evidencia (test o verificación explícita acordada).

“Pruebas al 100 %” significa:
- **100 % de los tests requeridos por la spec activa: escritos, ejecutados y en verde.**
- Más los umbrales de cobertura que la spec (o, en su defecto, el plan §9) fije para el código **tocado en esa fase**.

No se avanza a la siguiente spec con tests “pendientes”, `it.skip`, `xit`, `todo`, snapshots rotos ignorados, ni “lo cubrimos en la fase siguiente”.

### P5. El plan no se reinterpreta en silencio
Cambios de stack, de orden de fases, de alcance MVP (§1.2) o de reglas de negocio (§4.3, §5, §6) requieren:
- pregunta al usuario, y
- actualización de la spec y del plan,
antes de escribir código.

### P6. Calidad mínima del plan, aplicada por fase
Cuando la spec activa toca estos temas, el agente **debe** respetarlos; no son opcionales ni “después”:

- TypeScript estricto en todo el monorepo.
- Contratos en `packages/shared`; `web` y `api` no duplican Zod.
- Dinero en enteros (centavos); nada de flotantes.
- Stock solo vía `InventoryService` + kardex; nadie escribe `stock_location` por su cuenta (plan §2.4). Esto se implementa cuando la spec lo autorice (núcleo en F2, endpoints en F7/F8), **no** se adelanta UI de almacén/POS.
- Sin borrado físico de entidades con historial (`is_active`).
- Permisos: cada ruta nueva declara `requirePermission`; UI usa el mismo catálogo.
- Fuera del MVP (§1.3 / §11): no implementar.

---

## 2. Qué puede hacer el agente (y qué no) en cada modo

### 2.1 Antes de existir specs (`docs/specs/` vacío)
Autorizado: redactar specs según plan §14.  
**No autorizado:** implementar la app, instalar stack “para ir adelantando”, crear módulos de negocio.

Una spec `LISTA` debe incluir todo lo del plan §14:
- contexto y alcance (y **fuera de alcance** explícito);
- modelo de datos afectado (campos exactos);
- endpoints + esquemas Zod request/response **o** “N/A en esta fase”;
- pantallas / wireframe en texto **o** “N/A”;
- reglas de negocio y casos borde;
- TODOs ordenados, numerados, verificables;
- tests requeridos (lista cerrada);
- criterios de aceptación;
- cabecera de control (ver §3).

**Prohibido** marcar una spec `LISTA` si copia el plan en abstracto sin TODOs atómicos y sin lista de tests.

### 2.2 Implementación
Solo con spec `EN_PROGRESO` y autorización del usuario para esa spec.

El agente:
1. Lee constitución + spec activa + fragmentos citados del plan.
2. Ejecuta TODOs **en el orden de la spec**.
3. Escribe los tests de cada TODO **antes o junto** con el código de ese TODO (no al final de la fase como “luego los añado”).
4. Corre los tests de la spec activa al cerrar cada grupo de TODOs.
5. No toca archivos fuera del perímetro de la spec.

### 2.3 Código / comandos no autorizados
**Prohibido** sin permiso explícito en la spec o del usuario en el chat **para ese acto**:

- `prisma migrate` / seed de demo en entornos no previstos por la spec;
- cambiar dependencias no listadas (p. ej. Handsontable; el plan las prohíbe);
- scripts de producción, destrucciones de BD, push, deploy;
- generar endpoints “temporales” o UIs placeholder de módulos de fases futuras (F0 sí autoriza placeholders de layout: **solo** si F0 lo dice, y sin lógica de negocio).

Placeholders de F0: rutas vacías / “próximamente”, sin APIs falsas de productos/POS/almacén.

---

## 3. Cabecera obligatoria de cada spec

Al inicio de cada `docs/specs/fase-XX-*.md`:

```markdown
---
id: fase-00
titulo: Fundaciones
estado: BORRADOR | LISTA | EN_PROGRESO | BLOQUEADA | COMPLETA
depende_de: []          # ids de specs que deben estar COMPLETA
autoriza_codigo_en:     # rutas de repo permitidas, glob
  - "apps/api/**"
  - "apps/web/**"
  - "packages/shared/**"
  - "infra/**"
fuera_de_alcance:       # lista explícita
tests_requeridos_total: N
tests_requeridos_en_verde: 0
cobertura_minima:       # p.ej. 80% shared tocado; o "100% tests de esta spec"
definition_of_done: pendiente | cumplido
bloqueado_por: []       # preguntas abiertas
---
```

---

## 4. Definition of Done

Una spec solo pasa a `COMPLETA` cuando se cumplen **todas** estas condiciones:

1. Todos sus TODOs están marcados `[x]` y tienen evidencia (archivos o commit).
2. `tests_requeridos_en_verde == tests_requeridos_total`, sin `skip`, `only`, `todo` ni `xit`.
3. Se cumple la `cobertura_minima` de la cabecera; el resultado del reporte queda en la sección "Evidencia".
4. `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan en limpio en **todo** el monorepo.
5. Cada criterio de aceptación tiene evidencia: un test que lo cubre o una verificación manual acordada y documentada en "Evidencia".
6. `git diff --stat` no muestra archivos fuera de `autoriza_codigo_en`.
7. `bloqueado_por` está vacío.
8. La documentación tocada está actualizada (README; plan y spec si hubo cambios por P5).
9. El usuario confirma el cierre de forma explícita.

Al cerrar, la cabecera queda con `estado: COMPLETA` y `definition_of_done: cumplido`.
