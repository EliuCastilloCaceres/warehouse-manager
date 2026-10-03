---
id: fase-04
titulo: Usuarios y permisos
estado: LISTA
depende_de: [fase-03]
autoriza_codigo_en:
  - "apps/api/package.json"
  - "package.json"
  - "apps/api/src/core/errors.ts"
  - "apps/api/src/core/errors.test.ts"
  - "apps/api/src/core/password.ts"
  - "apps/api/src/core/password.test.ts"
  - "apps/api/src/modules/users/**"
  - "apps/api/src/scripts/**"
  - "apps/api/src/app.ts"
  - "apps/api/test/integration/users-*.int.test.ts"
  - "apps/api/test/integration/helpers/**"
  - "packages/shared/src/index.ts"
  - "packages/shared/src/users.ts"
  - "packages/shared/src/users.test.ts"
  - "packages/shared/src/errors.ts"
  - "packages/shared/src/errors.test.ts"
  - "apps/web/src/features/users/**"
  - "apps/web/src/app/routes.tsx"
  - "README.md"
  - "docs/plan/plan.md"
fuera_de_alcance:
  - "Crear, editar o borrar roles; los 5 roles del sistema solo se listan (F1 §9.4)"
  - "Transferir la propiedad (cambiar quién es el Propietario)"
  - "Pantalla de perfil propio para usuarios sin users.manage"
  - "Recuperación de contraseña por correo o SMS"
  - "Alta y baja de sucursales (F5 solo las edita; multi-sucursal completa es post-MVP)"
  - "Filtrar usuarios por la sucursal del administrador (post-MVP; la lista muestra los usuarios de todas las sucursales)"
  - "Bloqueo de cuentas por intentos fallidos más allá del rate limit de F2"
  - "Cambios a schema.prisma o migraciones (el modelo es de F1; si hiciera falta, se pregunta)"
tests_requeridos_total: 33
tests_requeridos_en_verde: 0
cobertura_minima: "100% de los tests de esta spec en verde; ≥ 80% (líneas y ramas) en apps/api/src/modules/users/**, apps/web/src/features/users/** y packages/shared (se mantiene)"
definition_of_done: pendiente
bloqueado_por: []
---

# Fase 4: Usuarios y permisos

## 1. Contexto y alcance

Referencias: plan §4.2 (seguridad), §6.1 (contraseñas), §6.2 (permisos, roles y escalada), §8 Fase 4 y §9 (pruebas). Se apoya en F1 (modelo, `SYSTEM_ROLES`, `hashPassword`), F2 (acceso por ruta, `effectivePermissions`, `AuthService.revokeAllForUser`, `AuditService`, paginación) y F3 (cliente HTTP, guards, `DataTable`, diálogos).

**Objetivo:** que quien tenga permiso gestione el acceso al sistema sin poder escalar privilegios, y que el Propietario quede protegido. Al terminar F4:

- se listan, crean, editan, desactivan y reactivan usuarios;
- al crear o restablecer, la contraseña se genera (y se muestra una sola vez) o la escribe el administrador; en los dos casos se exige cambiarla al entrar;
- nadie puede otorgar un rol o permiso que no tiene, ni actuar sobre alguien con más permisos;
- el Propietario solo se modifica a sí mismo, y su contraseña olvidada se restablece con un comando en el servidor;
- toda acción queda en el audit, nunca con contraseñas.

**Alcance (entra):**

1. Contratos de usuarios en `shared` y 4 códigos de error nuevos.
2. Generador de contraseñas legibles.
3. Endpoints de usuarios, roles y catálogo de permisos.
4. Reglas de alcance, escalada, Propietario y uno mismo.
5. Comando `owner:reset-password`.
6. UI: lista, alta/edición con matriz de permisos, acciones y modal de credenciales.

**Fuera de alcance:** ver la cabecera.

---

## 2. Modelo de datos afectado

Sin cambios de schema. Usa `User`, `Role`, `Permission`, `RolePermission`, `UserPermission`, `UserBranch`, `RefreshToken` y `AuditLog` de F1 §4.3, con el rol `OWNER` y el usuario `owner` del seed (F1 §6.4 y §7.2).

| Campo | Regla en F4 |
|---|---|
| `User.username` | Se fija al crear; después es inmutable. |
| `User.passwordHash` | Solo se escribe al crear, al restablecer (endpoint o comando) y en `change-password` (F2). |
| `User.mustChangePassword` | `true` al crear y al restablecer. |
| `User.isActive` | Se cambia solo con desactivar/reactivar. |
| `UserPermission` | Guarda solo los extras que el rol no da. |
| `UserBranch` | Al menos una fila por usuario y exactamente una `isDefault` (índice de F1 §5.2). |

---

## 3. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Módulo | `apps/api/src/modules/users/` con `users.routes.ts`, `roles.routes.ts` (roles y catálogo), `users.service.ts`, `users.repository.ts` y `ownerReset.ts`. Tag de Swagger `users`. Ninguna ruta es `branchScoped`. |
| Reglas puras en `shared` | `isWithinScope`, `missingPermissions` e `isAssignableRole` viven en `packages/shared/src/users.ts`. La API las usa para decidir y la web para deshabilitar controles; la API es la autoridad. |
| Alcance | Quien no es el propio usuario solo actúa sobre usuarios cuyos permisos efectivos ⊆ los suyos. Si no → 403 `USER_OUT_OF_SCOPE`. Con `ADMIN` (25) un Administrador gestiona a otros Administradores; un Gerente (24) no. |
| Escalada: rol | Un rol se asigna solo si sus permisos ⊆ los del actor. Si no → 403 `PERMISSION_ESCALATION` con `details.permissions` (los que faltan). Así, asignar `ADMIN` exige `users.permissions` (decisión del usuario). |
| Escalada: extras | Cambiar `extraPermissions` (incluido enviarlo no vacío al crear) exige `users.permissions` → si no, 403 `FORBIDDEN` con `details.permission: 'users.permissions'` (formato de F2). Los extras deben ⊆ los permisos del actor → si no, `PERMISSION_ESCALATION`. |
| Escalada: sucursales | Solo se asignan sucursales que el actor tiene en sus claims (`branchIds`; el Propietario y el Administrador tienen todas las activas). Si no → 403 `BRANCH_FORBIDDEN` (F2). |
| Propietario | El rol `OWNER` nunca es asignable: crear o cambiar a ese rol → 403 `USER_OWNER_PROTECTED`. Cualquier modificación del usuario Propietario por otro usuario (`PATCH`, desactivar, reactivar, restablecer) → 403 `USER_OWNER_PROTECTED`. Sobre sí mismo aplica la regla de "uno mismo". |
| Uno mismo | Sobre su propio usuario, nadie puede cambiar `roleId`, `extraPermissions`, `branchIds`/`defaultBranchId`, desactivarse ni usar `reset-password` (para eso está `change-password`) → 403 `USER_SELF_CHANGE_FORBIDDEN`. Sí puede editar `fullName`, `email` y `phone` si tiene `users.manage`. Esto cubre "nadie se quita `users.permissions`" y "el Propietario no se degrada". |
| Orden de validación | (1) esquema Zod → 400; (2) existencia del usuario → 404; (3) Propietario → `USER_OWNER_PROTECTED`; (4) uno mismo → `USER_SELF_CHANGE_FORBIDDEN`; (5) alcance → `USER_OUT_OF_SCOPE`; (6) extras sin `users.permissions` → `FORBIDDEN`; (7) escalada de rol/extras → `PERMISSION_ESCALATION`; (8) sucursales → `BRANCH_FORBIDDEN`; (9) referencias (`roleId`, sucursales activas) → 400 `VALIDATION_ERROR`; (10) unicidad → 409. |
| Extras normalizados | Al guardar, `extraPermissions` = conjunto pedido − permisos del rol (si cambia el rol, se recalcula con el rol nuevo). |
| Contraseña | `PasswordInput`: `{ mode: 'generate' }` o `{ mode: 'manual', value }` con `PasswordPolicy` de F2. Generada: `generateReadablePassword()` en `core/password.ts`: 12 caracteres del alfabeto `abcdefghjkmnpqrstuvwxyz23456789` (sin `i`, `l`, `o`, `0`, `1`) con `crypto.randomInt`, en 3 grupos de 4 unidos por `-` (p. ej. `k7mp-x3qa-9vtw`). La respuesta devuelve `generatedPassword` solo en modo `generate` (si no, `null`). La contraseña nunca va a logs ni al audit. |
| Sesiones | Desactivar y restablecer llaman a `AuthService.revokeAllForUser(userId, tx)` en la misma transacción. Cambios de rol, permisos o sucursales **no** revocan: se aplican en el siguiente refresh (≤ 15 min, F2 §14). |
| Desactivar/reactivar | Idempotentes: si el estado ya es el pedido, responden 200 sin escribir ni auditar. |
| Username sugerido | `suggestUsernameBase(fullName)` en `shared`: quita acentos (NFD), minúsculas, conserva `[a-z0-9]`; con 2+ palabras = inicial de la 1.ª + 2.ª palabra completa (`"Juan Pérez López"` → `jperez`); con 1 palabra = esa palabra; recorta a 30; si queda con menos de 3 caracteres → `null`. El endpoint agrega el primer sufijo libre (`jperez`, `jperez2`, `jperez3`…), recortando la base para no pasar de 30. |
| Audit | `AuditService.record` en la misma transacción, con `entity: 'User'`, `entityId` y la ip: `user.create` (`{ roleCode, branchIds, extraPermissions, passwordMode }`), `user.update` (solo campos cambiados, con valor anterior y nuevo), `user.deactivate`, `user.reactivate`, `user.password_reset` (`{ passwordMode }`) y `user.owner_password_reset` (comando, `userId: null`). |
| Comando del Propietario | `resetOwnerPassword(prisma)` en `ownerReset.ts`; entrada `apps/api/src/scripts/owner-reset-password.ts` (se compila con `src`). Solo exige `DATABASE_URL`. En una transacción: genera contraseña, guarda el hash, `mustChangePassword = true`, `revokeAllForUser` y audit. Imprime la contraseña una sola vez. Sin Propietario → código 1 y "No existe un Propietario. Ejecuta primero `pnpm db:seed`.", sin escribir. Scripts: `owner:reset-password` en `apps/api` (`tsx src/scripts/owner-reset-password.ts`) y en la raíz (delega). El uso en producción (`node dist/scripts/…` dentro del contenedor) se documenta en F10. |
| UI | `apps/web/src/features/users/` con hooks de TanStack Query sobre `apiFetch` (claves `['users', query]`, `['user', id]`, `['roles']`, `['permissions']`; las mutaciones invalidan `users` y `user`). Rutas `/users` (`users.read`), `/users/new` (`users.manage`) y `/users/:id` (`users.read`; editable con `users.manage`). |
| Etiquetas de módulos | `PERMISSION_MODULE_LABELS` en `features/users/moduleLabels.ts`: Usuarios, Productos, Almacén, Inventario, POS, Reportes, Ajustes. Son solo de presentación, por eso viven en `web`. |
| Sucursales en el formulario | Las opciones salen de `me.branches` del actor (F2), así que no hace falta un endpoint nuevo. Para roles `ADMIN`, el formulario avisa: "El Administrador accede a todas las sucursales activas; aquí se elige la predeterminada". |
| Rol Propietario en la UI | `OWNER` no aparece en el selector de roles. El Propietario se ve en la lista con la etiqueta "Propietario". |

---

## 4. Dependencias autorizadas (lista cerrada)

Ninguna nueva.

---

## 5. Contratos en `packages/shared` (`users.ts`, nuevo)

```ts
export const UsernameSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo');

export const PasswordInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate') }),
  z.object({ mode: z.literal('manual'), value: PasswordPolicy }),
]);

const FullName = z.string().trim().min(1, 'El nombre es obligatorio').max(100);
const Email = z.email('Correo no válido').nullable();
const Phone = z.string().trim().max(30).nullable();
const PermissionSet = z.array(PermissionCode).transform((v) => [...new Set(v)].sort());
const BranchIds = z.array(Uuid).min(1, 'Elige al menos una sucursal').transform((v) => [...new Set(v)]);

export const UserCreateInput = z.object({
  username: UsernameSchema,
  fullName: FullName,
  email: Email.optional().default(null),
  phone: Phone.optional().default(null),
  roleId: Uuid,
  branchIds: BranchIds,
  defaultBranchId: Uuid,
  extraPermissions: PermissionSet.default([]),
  password: PasswordInput,
}).refine((v) => v.branchIds.includes(v.defaultBranchId), {
  path: ['defaultBranchId'], message: 'La sucursal predeterminada debe estar entre las asignadas',
});

export const UserUpdateInput = z.strictObject({
  fullName: FullName.optional(),
  email: Email.optional(),
  phone: Phone.optional(),
  roleId: Uuid.optional(),
  branchIds: BranchIds.optional(),
  defaultBranchId: Uuid.optional(),
  extraPermissions: PermissionSet.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debes cambiar al menos un campo' })
  .refine((v) => !v.branchIds || (v.defaultBranchId !== undefined && v.branchIds.includes(v.defaultBranchId)), {
    path: ['defaultBranchId'], message: 'La sucursal predeterminada debe estar entre las asignadas',
  });

export const UserListQuery = PaginationQuery.extend({
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  roleId: Uuid.optional(),
  branchId: Uuid.optional(),
  sort: sortQuery(['fullName', 'username', 'lastLoginAt', 'createdAt']),   // default: fullName:asc
});

const RoleRef = z.object({ id: Uuid, code: z.string(), name: z.string() });
const UserBranchRef = z.object({ id: Uuid, code: z.string(), name: z.string(), isDefault: z.boolean() });

export const UserListItemDto = UserDto.extend({ role: RoleRef, branches: z.array(UserBranchRef) });
export const UserDetailDto = UserListItemDto.extend({
  extraPermissions: z.array(PermissionCode),
  effectivePermissions: z.array(PermissionCode),
});
export const UserCreatedDto = z.object({ user: UserDetailDto, generatedPassword: z.string().nullable() });
export const PasswordResetResultDto = z.object({ generatedPassword: z.string().nullable() });
export const UsernameSuggestionDto = z.object({ username: UsernameSchema.nullable() });
export const RoleWithPermissionsDto = RoleDto.extend({
  permissions: z.array(PermissionCode),
  assignable: z.boolean(),          // según el actor (§3)
});
export const PermissionGroupDto = z.object({
  module: z.enum(PERMISSION_MODULES),
  permissions: z.array(z.object({ code: PermissionCode, description: z.string() })),
});

// Reglas puras (§3)
export function isWithinScope(actorPerms: PermissionCode[], targetPerms: PermissionCode[]): boolean;
export function missingPermissions(actorPerms: PermissionCode[], requested: PermissionCode[]): PermissionCode[];
export function isAssignableRole(roleCode: string, rolePerms: PermissionCode[], actorPerms: PermissionCode[]): boolean; // OWNER → false
export function suggestUsernameBase(fullName: string): string | null;
```

`UserDto`, `RoleDto` y `PaginationQuery`/`sortQuery` son de F1; `PasswordPolicy` es de F2. Los tipos se exportan con `z.infer`.

**`errors.ts`:** `ErrorCode` agrega `USER_OWNER_PROTECTED`, `USER_OUT_OF_SCOPE`, `USER_SELF_CHANGE_FORBIDDEN` y `PERMISSION_ESCALATION`. En `apps/api/src/core/errors.ts` los cuatro son **403**, con estos mensajes:

| Código | Mensaje |
|---|---|
| `USER_OWNER_PROTECTED` | "El Propietario solo puede ser modificado por él mismo." |
| `USER_OUT_OF_SCOPE` | "No puedes modificar a un usuario con permisos que tú no tienes." |
| `USER_SELF_CHANGE_FORBIDDEN` | "No puedes cambiar tu propio rol, permisos, sucursales ni estado." |
| `PERMISSION_ESCALATION` | "No puedes otorgar permisos que no tienes." |

---

## 6. Endpoints

Todos bajo `/api/v1`, con tag `users`. Las respuestas de error son `ApiErrorDto`.

| Método y ruta | Acceso | Request | Respuestas |
|---|---|---|---|
| `GET /users` | `users.read` | `UserListQuery` | 200 `paginated(UserListItemDto)` · 400 · 401 · 403 |
| `GET /users/suggest-username` | `users.manage` | query `fullName` (1–100) | 200 `UsernameSuggestionDto` · 400 · 403 |
| `GET /users/:id` | `users.read` | — | 200 `UserDetailDto` · 404 |
| `POST /users` | `users.manage` | `UserCreateInput` | 201 `UserCreatedDto` · 400 · 403 (`FORBIDDEN`, `PERMISSION_ESCALATION`, `USER_OWNER_PROTECTED`, `BRANCH_FORBIDDEN`) · 409 `CONFLICT` (`details.target: ['username']`) |
| `PATCH /users/:id` | `users.manage` | `UserUpdateInput` | 200 `UserDetailDto` · 400 · 403 (los de §3) · 404 |
| `POST /users/:id/deactivate` | `users.manage` | — | 200 `UserDetailDto` · 403 · 404 |
| `POST /users/:id/reactivate` | `users.manage` | — | 200 `UserDetailDto` · 403 · 404 |
| `POST /users/:id/reset-password` | `users.manage` | `PasswordInput` | 200 `PasswordResetResultDto` · 400 · 403 · 404 |
| `GET /roles` | `users.read` | — | 200 `RoleWithPermissionsDto[]` (orden: OWNER, ADMIN, MANAGER, SELLER, WAREHOUSE_CLERK) |
| `GET /permissions` | `users.read` | — | 200 `PermissionGroupDto[]` (orden de `PERMISSION_MODULES` y del catálogo) |

`q` en `GET /users` busca en `username`, `fullName` y `email` (`containsInsensitive` de F2). `branchId` filtra por `UserBranch`. Ninguna respuesta incluye `passwordHash`.

---

## 7. Pantallas (wireframe en texto)

**Lista (`/users`)**

```
┌──────────────────────────────┐
│ Usuarios        [+ Nuevo]    │  ← "Nuevo" solo con users.manage
│ [🔍 Buscar nombre o usuario] │
│ [Activos ▾] [Rol ▾] [Suc. ▾] │  ← estado por defecto: Activos
├──────────────────────────────┤
│ Eliu Castillo   (Propietario)│  ← tarjeta en móvil
│ owner · S1 · últ. acceso hoy │
├──────────────────────────────┤
│ Juan Pérez         Vendedor  │
│ jperez · S1 · ● Activo       │
│ ⚠ Debe cambiar contraseña    │
└──────────────────────────────┘
```

En escritorio, `DataTable` con columnas Nombre, Usuario, Rol, Sucursales, Estado y Último acceso.

**Alta y edición (`/users/new`, `/users/:id`)**

```
  Datos
  Nombre completo [Juan Pérez López____]
  Usuario         [jperez______] (sugerido)  ← solo editable al crear
  Correo          [____________]
  Teléfono        [____________]

  Rol
  [Vendedor ▾]   (Administrador deshabilitado: "Requiere permisos que no tienes")

  Sucursales
  ☑ S1 · Sucursal 1   ◉ predeterminada

  Permisos                         ← editable solo con users.permissions
  Productos   ☑ Ver productos            (del rol, bloqueado)
              ☐ Crear, editar…           (extra)
              ☐ Carga masiva             (deshabilitado: no lo tienes)
  POS         …

  Contraseña                       ← solo al crear
  ◉ Generar automáticamente   ○ Escribirla [________]

  [        Guardar        ]
```

**Acciones en el detalle** (con `users.manage`, si la regla lo permite): [Restablecer contraseña] → diálogo con "Generar" / "Escribir"; [Desactivar] o [Reactivar] → `ConfirmDialog` ("¿Desactivar a Juan Pérez? Se cerrarán sus sesiones.").

**Modal "Credenciales"** (al crear o restablecer en modo generar):

```
  Credenciales de Juan Pérez
  Usuario:     jperez
  Contraseña:  k7mp-x3qa-9vtw      [Copiar]
  ⚠ Esta contraseña no se volverá a mostrar.
    Se pedirá cambiarla al iniciar sesión.
  [        Entendido        ]       ← única forma de cerrar
```

**Casos especiales:**
- Propietario visto por otro usuario: etiqueta "Propietario", formulario de solo lectura y sin acciones.
- Uno mismo: rol, sucursales y permisos de solo lectura, con la nota "Para cambiar tu contraseña usa Cambiar contraseña"; sin Desactivar ni Restablecer.
- Usuario fuera de alcance: solo lectura, con la nota "Tiene permisos que tú no tienes".

---

## 8. Reglas y casos borde

1. **Gerente intenta crear un Administrador:** 403 `PERMISSION_ESCALATION` con `details.permissions: ['users.permissions']`.
2. **Administrador intenta asignar el rol Propietario:** 403 `USER_OWNER_PROTECTED`.
3. **Cualquiera intenta modificar al Propietario:** 403 `USER_OWNER_PROTECTED`, también un Administrador con los 25 permisos.
4. **El Propietario edita sus datos:** permitido (`fullName`, `email`, `phone`); su rol, sucursales y estado no cambian.
5. **Usuario desactivado:** sus refresh tokens se revocan en la misma transacción; su access token vigente sirve hasta que vence (≤ 15 min, F2 §9.3). No puede iniciar sesión.
6. **Restablecer contraseña:** revoca todas las sesiones del usuario y activa `mustChangePassword`.
7. **Username duplicado:** 409 `CONFLICT`; la UI lo muestra en el campo como "Este usuario ya existe".
8. **Sucursal inactiva o inexistente en `branchIds`:** 400 `VALIDATION_ERROR` con `path: 'branchIds'`. **Rol inexistente:** 400 con `path: 'roleId'`. **`PATCH` con solo `defaultBranchId`:** debe estar entre las sucursales actuales del usuario; si no, 400 con `path: 'defaultBranchId'`.
9. **Extras que ya da el rol:** se descartan al guardar.
10. **Desactivar a alguien ya inactivo:** 200 sin escritura ni audit.
11. **Contraseñas:** no aparecen en logs, en el audit ni en respuestas, salvo `generatedPassword` en la respuesta que la genera.
12. **Comando del Propietario sin Propietario en la BD:** termina con código 1 sin escribir.
13. **Cambio de permisos de un usuario con sesión abierta:** se refleja en sus claims y en su menú en el siguiente refresh.

---

## 9. TODOs (en orden, verificables)

- [ ] **1. Contratos.**
  - Crear `shared/users.ts` (esquemas, DTOs y reglas puras) y ampliar `ErrorCode`. Agregar los 4 códigos a `ERROR_HTTP_STATUS` y `ERROR_MESSAGES` de la API. Tests **T1–T6** (y T3 de F2 sigue en verde con los códigos nuevos).
  - *Verificable:* T1–T6 en verde.
- [ ] **2. Generador de contraseñas.**
  - `generateReadablePassword()` en `core/password.ts`. Test **T7**.
  - *Verificable:* T7 en verde.
- [ ] **3. Lectura.**
  - `users.repository.ts`, `users.service.ts` (lectura), `GET /users`, `GET /users/:id`, `GET /roles` y `GET /permissions`; registrar las rutas en `app.ts`; helpers de test para crear usuarios e iniciar sesión. Tests **T8**, **T9** y **T22**.
  - *Verificable:* T8, T9 y T22 en verde.
- [ ] **4. Alta y username sugerido.**
  - `POST /users` y `GET /users/suggest-username`. Tests **T10–T13** y **T21**.
  - *Verificable:* T10–T13 y T21 en verde.
- [ ] **5. Edición.**
  - `PATCH /users/:id` con normalización de extras. Tests **T14**, **T15** y **T20**.
  - *Verificable:* T14, T15 y T20 en verde.
- [ ] **6. Protecciones.**
  - Reglas del Propietario y de uno mismo en todas las mutaciones. Tests **T16–T17**.
  - *Verificable:* T16–T17 en verde.
- [ ] **7. Estado y contraseña.**
  - `deactivate`, `reactivate` y `reset-password`, con revocación de sesiones. Tests **T18–T19**.
  - *Verificable:* T18–T19 en verde.
- [ ] **8. Audit.**
  - Registrar las acciones de §3. Test **T23**.
  - *Verificable:* T23 en verde.
- [ ] **9. Comando del Propietario.**
  - `ownerReset.ts`, `scripts/owner-reset-password.ts` y los scripts en `apps/api` y la raíz. Test **T24**.
  - *Verificable:* T24 en verde y `pnpm owner:reset-password` funciona sobre la BD de desarrollo.
- [ ] **10. UI: lista.**
  - Hooks de datos, `UsersListPage` y rutas. Test **T25**.
  - *Verificable:* T25 en verde.
- [ ] **11. UI: formulario.**
  - `UserFormPage` (alta y edición), selector de rol, sucursales, `PermissionMatrix` y modo de contraseña. Tests **T26** y **T28–T31**.
  - *Verificable:* T26 y T28–T31 en verde.
- [ ] **12. UI: credenciales y acciones.**
  - `CredentialsDialog`, acciones de desactivar/reactivar/restablecer y manejo de errores. Tests **T27**, **T32** y **T33**.
  - *Verificable:* T27, T32 y T33 en verde.
- [ ] **13. README y cierre.**
  - En el README: gestión de usuarios, el rol Propietario y `pnpm owner:reset-password`.
  - Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`; hacer las verificaciones manuales; registrar la cobertura; llenar §12 Evidencia y aplicar la Definition of Done (constitución §4).

---

## 10. Tests requeridos (lista cerrada: 33)

Los marcados con "int" corren contra `postgres-test` con `app.inject`, sobre el seed base (`owner`, `admin` y los 5 roles). Los de `web` usan Jest + RTL con `fetch` simulado.

| ID | Archivo | Caso |
|---|---|---|
| T1 | `shared` · `users.test.ts` | `UsernameSchema`: `" JPerez "` → `"jperez"`; acepta `"j.perez_2"`; rechaza `"jp"`, 31 caracteres, `"juan perez"` y `"ñandu"` (`it.each`). |
| T2 | `shared` · `users.test.ts` | `suggestUsernameBase` (`it.each`): `"Juan Pérez López"` → `"jperez"`; `"Ana"` → `"ana"`; `"José O'Brien"` → `"jobrien"`; `"Lu"` → `null`; `"   "` → `null`; un nombre muy largo se recorta a 30. |
| T3 | `shared` · `users.test.ts` | `UserCreateInput`: válido con `generate` y con `manual`; `manual` con 7 caracteres → error; `branchIds` vacío → error; `defaultBranchId` fuera de `branchIds` → error con `path` `defaultBranchId`; permiso inexistente → error; extras duplicados se deduplican y ordenan. |
| T4 | `shared` · `users.test.ts` | `UserUpdateInput`: `{}` → "Debes cambiar al menos un campo"; con `username` → error (estricto); parcial válido; `branchIds` sin `defaultBranchId` → error. `UserListQuery`: `isActive: 'false'` → `false`; `sort` acepta `fullName:asc` y rechaza `email:asc`. |
| T5 | `shared` · `users.test.ts` | Reglas puras con `SYSTEM_ROLES` (`it.each`): `isWithinScope` (ADMIN sobre MANAGER → `true`; MANAGER sobre ADMIN → `false`; ADMIN sobre ADMIN → `true`); `missingPermissions(MANAGER, ADMIN)` → `['users.permissions']`; `isAssignableRole`: `OWNER` → `false` para todos, `ADMIN` → `false` para MANAGER y `true` para ADMIN. |
| T6 | `shared` · `errors.test.ts` + `users.test.ts` | Los 4 códigos nuevos existen en `ErrorCode`. Las fixtures de `UserDetailDto`, `UserCreatedDto`, `RoleWithPermissionsDto` y `PermissionGroupDto` son válidas, y al parsear con `UserDetailDto` un objeto que trae `passwordHash`, el resultado no lo incluye. |
| T7 | `api` · `core/password.test.ts` | `generateReadablePassword()`: formato `^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$`, cumple `PasswordPolicy` y 1 000 llamadas no repiten valor. |
| T8 | `int` · `users-read.int.test.ts` | `GET /users`: paginación, `q` por nombre, usuario y correo, filtros `isActive`, `roleId` y `branchId`, orden por defecto `fullName:asc`; cada item cumple `UserListItemDto` y no trae `passwordHash`; un `SELLER` → 403 `FORBIDDEN`. |
| T9 | `int` · `users-read.int.test.ts` | `GET /users/:id` → `UserDetailDto` con `extraPermissions` y `effectivePermissions` correctos; id inexistente → 404 `NOT_FOUND`. |
| T10 | `int` · `users-create.int.test.ts` | `POST /users` con `generate` → 201; `generatedPassword` con el formato de T7; en BD `mustChangePassword: true`, hash argon2id que verifica, `UserBranch` con la predeterminada. Con esas credenciales, `POST /auth/login` → 200 con `me.user.mustChangePassword: true`. |
| T11 | `int` · `users-create.int.test.ts` | `POST /users` con `manual` → 201 con `generatedPassword: null` y el hash verifica con el valor enviado; `manual` de 7 caracteres → 400 `VALIDATION_ERROR` con `path` en `password.value`. |
| T12 | `int` · `users-create.int.test.ts` | Username duplicado → 409 `CONFLICT` con `details.target` que incluye `username`; `roleId` inexistente → 400 (`path: 'roleId'`); sucursal inactiva → 400 (`path: 'branchIds'`). Ningún caso deja filas escritas. |
| T13 | `int` · `users-create.int.test.ts` | Escalada al crear: un MANAGER crea un ADMIN → 403 `PERMISSION_ESCALATION` con `details.permissions: ['users.permissions']`; un MANAGER envía extras → 403 `FORBIDDEN` con `details.permission: 'users.permissions'`; un ADMIN crea con rol `OWNER` → 403 `USER_OWNER_PROTECTED`; una sucursal fuera de los claims del actor → 403 `BRANCH_FORBIDDEN`. |
| T14 | `int` · `users-update.int.test.ts` | `PATCH` cambia `fullName`, `email`, `phone`, rol, sucursales y extras; los extras que ya da el rol nuevo se descartan; con `username` → 400; con `{}` → 400; `updatedAt` cambia. |
| T15 | `int` · `users-update.int.test.ts` | Alcance: un MANAGER edita a un ADMIN → 403 `USER_OUT_OF_SCOPE`; un ADMIN edita a otro ADMIN → 200; un ADMIN agrega a un SELLER un extra que sí tiene → 200. |
| T16 | `int` · `users-owner.int.test.ts` | Un ADMIN hace `PATCH`, `deactivate`, `reactivate` y `reset-password` sobre `owner` → 403 `USER_OWNER_PROTECTED` en los cuatro, sin cambios en BD. `owner` edita su propio `fullName` → 200; `owner` cambia su `roleId` o sus `branchIds` → 403 `USER_SELF_CHANGE_FORBIDDEN`. |
| T17 | `int` · `users-self.int.test.ts` | Un ADMIN sobre sí mismo: `deactivate` → 403 `USER_SELF_CHANGE_FORBIDDEN`; cambiar su rol o sus extras → 403; `reset-password` → 403; editar su `phone` → 200. |
| T18 | `int` · `users-status.int.test.ts` | `deactivate` → 200, `isActive: false`; los refresh tokens del usuario quedan revocados (`POST /auth/refresh` con su cookie → 401 `AUTH_REFRESH_INVALID`) y su login → 401. Repetir `deactivate` → 200 sin un segundo `AuditLog`. `reactivate` → 200 y el login vuelve a funcionar. |
| T19 | `int` · `users-status.int.test.ts` | `reset-password` con `generate` y con `manual`: `mustChangePassword: true`; todas sus sesiones revocadas; la contraseña anterior falla y la nueva funciona; `generatedPassword` solo en modo `generate`. |
| T20 | `int` · `users-update.int.test.ts` | Tras agregar un extra a un usuario con sesión abierta, sus tokens **no** se revocan y su siguiente `POST /auth/refresh` trae el permiso en `perms` y en `me.permissions`. |
| T21 | `int` · `users-create.int.test.ts` | `GET /users/suggest-username?fullName=Juan Pérez` → `jperez`; con `jperez` existente → `jperez2`; con `jperez` y `jperez2` → `jperez3`; `fullName=Lu` → `null`; un SELLER → 403. |
| T22 | `int` · `users-read.int.test.ts` | `GET /roles` devuelve los 5 roles en el orden de §6 con sus permisos; `assignable` para un MANAGER: MANAGER, SELLER y WAREHOUSE_CLERK `true`, ADMIN y OWNER `false`; para un ADMIN: ADMIN `true` y OWNER `false`. `GET /permissions` → 7 grupos y 25 permisos en orden. |
| T23 | `int` · `users-audit.int.test.ts` | Crear, editar, desactivar, reactivar y restablecer generan su `AuditLog` (`action`, `userId` del actor, `entity: 'User'`, `entityId`, `ip`); `user.update` trae solo los campos cambiados; ningún `payload` contiene la contraseña (ni la generada ni la manual). |
| T24 | `int` · `users-owner-reset.int.test.ts` | `resetOwnerPassword(prisma)`: devuelve una contraseña con el formato de T7 que verifica contra el hash; `mustChangePassword: true`; las sesiones de `owner` quedan revocadas; hay `AuditLog` `user.owner_password_reset` con `userId: null`. Sin Propietario lanza "No existe un Propietario. Ejecuta primero `pnpm db:seed`." sin escribir. |
| T25 | `web` · `UsersListPage.test.tsx` | Muestra los usuarios del API simulado; escribir en la búsqueda dispara una consulta con `q` (con *debounce*); los filtros cambian la query; "Nuevo usuario" solo aparece con `users.manage`; la fila del Propietario lleva la etiqueta "Propietario". |
| T26 | `web` · `UserFormPage.test.tsx` | Alta: al escribir el nombre se pide la sugerencia y se llena "Usuario" (editable); "Escribirla" muestra el campo de contraseña con su validación; al guardar se envía un `UserCreateInput` válido; un 409 muestra "Este usuario ya existe" en el campo. |
| T27 | `web` · `CredentialsDialog.test.tsx` | Muestra usuario y contraseña; "Copiar" llama a `navigator.clipboard.writeText`; `Escape` y el clic fuera no lo cierran; "Entendido" sí. |
| T28 | `web` · `PermissionMatrix.test.tsx` | Agrupa por módulo con las etiquetas en español; los permisos del rol aparecen marcados y bloqueados ("Del rol"); los extras se alternan; sin `users.permissions` la matriz es de solo lectura; los permisos que el actor no tiene están deshabilitados. |
| T29 | `web` · `UserFormPage.test.tsx` | El selector de rol no incluye `OWNER`; los roles con `assignable: false` aparecen deshabilitados con "Requiere permisos que no tienes"; con rol `ADMIN` se ve el aviso de sucursales. |
| T30 | `web` · `UserFormPage.test.tsx` | Las sucursales salen de `me.branches`; la predeterminada solo se elige entre las marcadas; desmarcar la predeterminada la limpia y muestra el error de validación. |
| T31 | `web` · `UserFormPage.test.tsx` | Edición: "Usuario" es de solo lectura; el Propietario visto por otro es de solo lectura y sin acciones; sobre uno mismo, rol, sucursales y permisos son de solo lectura y no hay "Desactivar" ni "Restablecer"; un usuario fuera de alcance se muestra de solo lectura con su nota. |
| T32 | `web` · `UserActions.test.tsx` | "Desactivar" pide confirmación, llama a la API y muestra un *toast*; "Reactivar" igual; "Restablecer" en modo generar abre `CredentialsDialog` y en modo escribir muestra un *toast* sin contraseña. |
| T33 | `web` · `UserActions.test.tsx` | Un 403 `USER_OUT_OF_SCOPE`, `PERMISSION_ESCALATION` o `USER_OWNER_PROTECTED` muestra el `message` de la API en un *toast* y no cambia la vista (`it.each`). |

No se permiten `skip`, `only`, `todo` ni `xit` (constitución P4). Los tests de F0–F3 siguen en verde.

---

## 11. Criterios de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| CA1 | Un usuario creado puede iniciar sesión, se le pide cambiar la contraseña y solo ve los módulos permitidos. | T10, F3 T17 + verificación manual |
| CA2 | Un usuario desactivado pierde el acceso de inmediato (como máximo cuando expira su access token, 15 min) y sus sesiones quedan revocadas. | T18 |
| CA3 | Ningún usuario puede quitarse `users.permissions`, cambiar su propio rol ni desactivarse. | T17 |
| CA4 | Nadie, salvo el propio Propietario, puede modificarlo, y él no puede degradarse. El rol `OWNER` no se asigna desde la app. | T13, T16 |
| CA5 | Nadie otorga un rol, permiso o sucursal que no tiene, ni actúa sobre usuarios con más permisos. | T13, T15, T22 |
| CA6 | Las contraseñas generadas se muestran una sola vez y nunca aparecen en el audit ni en los logs. | T10, T19, T23, T27 |
| CA7 | El Propietario recupera el acceso con `pnpm owner:reset-password`. | T24 + verificación manual |
| CA8 | La gestión de usuarios funciona en móvil y escritorio. | T25–T32 + verificación manual |
| CA9 | `pnpm lint`, `pnpm typecheck`, `pnpm test` (con `pnpm dev:db`) y `pnpm build` pasan en limpio, incluidos los tests de F0–F3. | Salida de los comandos en §12 |
| CA10 | Se cumple la cobertura de la cabecera. | Reporte de `jest --coverage` en §12 |

---

## 12. Evidencia

*(Se completa al cerrar la fase.)*

---

## 13. Registro de decisiones

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-10-03 | Asignar el rol Administrador o permisos extra exige `users.permissions`, y nadie otorga un permiso que no tiene. | Usuario (chat); plan §6.2 actualizado |
| 2026-10-03 | Al crear o restablecer, la contraseña se genera o la escribe el administrador; en los dos casos queda `mustChangePassword`. | Usuario (chat); plan §6.1 y §8 F4 actualizados |
| 2026-10-03 | Rol `OWNER` ("Propietario"): único, creado por el seed como usuario aparte `owner`, con todos los permisos siempre; solo él se modifica y no puede degradarse; no se asigna desde la app. | Usuario (chat); plan §6.2, F1, F2 y F3 actualizados |
| 2026-10-03 | Contraseña olvidada del Propietario: comando de servidor `pnpm owner:reset-password`. | Usuario (chat); plan §6.2 y §8 F4 actualizados |
| 2026-10-03 | El username se sugiere y se edita solo al crear; después es inmutable. | Usuario (chat); plan §8 F4 actualizado |
| 2026-10-03 | Regla de alcance: solo se actúa sobre usuarios cuyos permisos efectivos ⊆ los del actor; con ella no hace falta proteger al "último Administrador", porque el Propietario siempre existe. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Regla de "uno mismo": nadie cambia su propio rol, extras, sucursales ni estado, ni usa `reset-password` sobre sí; sí edita nombre, correo y teléfono. Cubre al Propietario. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Solo se asignan sucursales que el actor tiene en sus claims (`BRANCH_FORBIDDEN`); las opciones del formulario salen de `me.branches`. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Códigos nuevos, todos 403: `USER_OWNER_PROTECTED`, `USER_OUT_OF_SCOPE`, `USER_SELF_CHANGE_FORBIDDEN` y `PERMISSION_ESCALATION`; extras sin `users.permissions` usan `FORBIDDEN` de F2. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Reglas puras (`isWithinScope`, `missingPermissions`, `isAssignableRole`) y `suggestUsernameBase` en `shared`, compartidas por API y web. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Contraseña generada: 12 caracteres sin ambiguos en 3 grupos con guion. Username sugerido: inicial del nombre + segunda palabra, con sufijo numérico si existe. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Cambios de rol, permisos o sucursales no revocan sesiones (se aplican en el siguiente refresh); desactivar y restablecer sí. Desactivar y reactivar son idempotentes. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | Los extras que ya da el rol no se guardan. `OWNER` no aparece en el selector de roles. La lista no se filtra por la sucursal del actor en el MVP. | Propuesta del agente; revisar al aprobar |
| 2026-10-03 | El usuario aprueba la spec completa, incluidas las propuestas del agente marcadas "revisar al aprobar". Spec pasa a `LISTA`. | Usuario (chat) |
| 2026-10-03 | El catálogo pasa a 25 permisos (`inventory.other_branches.read`) y el seed crea `S2`; cambian §3 (alcance), el caso borde 3, T22 y la nota de fuera de alcance sobre el filtro por sucursal. | Usuario (chat), durante la revisión de F6; F1 §6.4 y §7.2 actualizados |
