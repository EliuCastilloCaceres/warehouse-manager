# warehouse-manager

Sistema web _mobile-first_ (PWA) para operar almacén y punto de venta de una empresa de calzado, bolsos y accesorios. Monorepo pnpm con TypeScript estricto:

| Paquete           | Qué es                                          |
| ----------------- | ----------------------------------------------- |
| `apps/api`        | API Fastify (`/api/v1`), Swagger en `/api/docs` |
| `apps/web`        | SPA React + Vite + Tailwind                     |
| `packages/shared` | Contratos Zod compartidos entre API y web       |
| `infra/`          | Docker Compose de desarrollo y scripts          |

La documentación del proyecto está en `docs/` (plan, constitución y specs por fase).

## Requisitos

- **Node 24** (ver `.nvmrc`).
- **pnpm** vía corepack: `corepack enable pnpm`. La versión está fijada en `packageManager` del `package.json`. Si `corepack enable` falla por permisos en Windows, usa una carpeta de usuario que esté en el `PATH`: `corepack enable pnpm --install-directory "%APPDATA%\npm"`.
- **Docker** con Docker Compose (Docker Desktop en Windows y macOS).
- **mkcert**, solo para HTTPS en desarrollo (ver abajo).

## Instalación

```bash
pnpm install
cp .env.example .env      # en Windows: copy .env.example .env
```

Revisa los valores de `.env`; cada variable está comentada en `.env.example`.

## Desarrollo

```bash
pnpm dev:db     # levanta PostgreSQL 16 en Docker: desarrollo (5432) y pruebas (5433)
pnpm dev        # API en :3000 y web en :5173
```

- Web: <http://localhost:5173> (o `https://` si generaste certificados).
- API: <http://localhost:3000/api/v1/health>
- Swagger: <http://localhost:3000/api/docs>

La web llama siempre a rutas relativas (`/api/v1/...`) y Vite las reenvía a `API_PROXY_TARGET`. Si en tu equipo otro servicio ya usa el puerto 3000 en `localhost` (por ejemplo, un contenedor de otro proyecto), pon `API_PROXY_TARGET=http://127.0.0.1:3000` o cambia `PORT`.

Para detener la base de datos: `docker compose -f infra/docker-compose.dev.yml down` (los datos de desarrollo quedan en el volumen `pgdata`; la BD de pruebas vive en memoria y se borra).

## Base de datos

El modelo está en `apps/api/prisma/schema.prisma` (diagramas en [`docs/erd.md`](docs/erd.md)). Desde una BD vacía:

```bash
pnpm dev:db       # si no está levantada
pnpm db:migrate   # aplica las migraciones (init + constraints)
pnpm db:seed      # permisos, roles, sucursales S1/S2, cajas, staging, usuarios owner y admin
pnpm seed:demo    # opcional: zonas, racks, un catálogo de ejemplo y stock en S1 y en el staging de S2
```

- **Contraseñas iniciales:** antes del primer `pnpm db:seed`, cambia `OWNER_INITIAL_PASSWORD` y `ADMIN_INITIAL_PASSWORD` en `.env` (mínimo 8 caracteres). Los usuarios `owner` (Propietario) y `admin` (Administrador) deberán cambiarlas al entrar. El seed nunca restablece una contraseña que ya existe.
- Los dos seeds se pueden correr las veces que quieras: solo crean lo que falta y no sobrescriben lo que hayas editado (el seed base sí sincroniza los permisos y roles del sistema).
- **Cambios al modelo:** edita `schema.prisma` y corre `pnpm db:migrate --name <descripcion>`. Después regenera el cliente con `pnpm --filter @warehouse-manager/api db:generate` (Prisma 7 ya no lo hace solo al migrar; `build`, `typecheck` y `test` lo regeneran por su cuenta).
- **Empezar de cero en desarrollo** (borra todos los datos de `warehouse_dev`): `pnpm --filter @warehouse-manager/api exec prisma migrate reset`, y luego `pnpm db:seed` (y `pnpm seed:demo` si lo quieres).

## Autenticación (API)

- **`JWT_SECRET`** (obligatoria, ≥ 32 caracteres) firma los access tokens. Genera una por equipo y no la compartas: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Si cambia, todas las sesiones abiertas dejan de servir.
- El access token dura `ACCESS_TTL_MIN` (15 min) y viaja en `Authorization: Bearer`. El refresh token va en la cookie `wm_rt` (`HttpOnly`, `SameSite=Strict`, solo en `/api/v1/auth`), dura `REFRESH_TTL_DAYS` (7 días) y se renueva en cada uso.
- **`COOKIE_SECURE`:** con `true` (por defecto) el navegador solo guarda la cookie por **HTTPS**. Si en desarrollo abres la web por `http://`, pon `COOKIE_SECURE=false` o no podrás renovar la sesión.
- Un usuario con `mustChangePassword` (como `owner` y `admin` recién sembrados) solo puede usar `GET /auth/me`, `POST /auth/change-password` y `POST /auth/logout` hasta cambiar su contraseña.

**Probar el login con Swagger:** abre `/api/docs`, ejecuta `POST /api/v1/auth/login` con `{ "username": "admin", "password": "<ADMIN_INITIAL_PASSWORD>" }`, copia `accessToken` de la respuesta, pulsa **Authorize** (candado) y pégalo. Las rutas con candado ya se pueden probar.

**Con curl** (cambia el puerto si usas otro `PORT`):

```bash
curl -s -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_INITIAL_PASSWORD>"}' \
  http://127.0.0.1:3000/api/v1/auth/login                 # devuelve accessToken y guarda la cookie
curl -s -H "authorization: Bearer <accessToken>" http://127.0.0.1:3000/api/v1/auth/me
curl -s -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:3000/api/v1/auth/refresh
```

Con `COOKIE_SECURE=true`, curl no reenvía la cookie por `http://`; para probar `refresh` con curl por HTTP usa `COOKIE_SECURE=false`.

## Uso de la app web

### Primer ingreso

1. Abre la web (`https://localhost:5173` o `https://<IP-LAN>:5173`) y entra con `owner` o `admin` y la contraseña inicial de `.env`.
2. La app pide cambiar la contraseña antes de continuar (mínimo 8 caracteres, distinta de la actual). Mientras no la cambies, solo puedes hacerlo o cerrar sesión.
3. Si tu usuario tiene más de una sucursal, eliges una (la predeterminada viene marcada). La app la recuerda en ese navegador; se cambia desde el menú de usuario (tus iniciales, arriba a la derecha).

La sesión sobrevive a recargar la página y se renueva sola. Cerrar sesión en una pestaña la cierra en las demás. El menú solo muestra los módulos que permite tu rol.

### Usuarios y permisos

Módulo **Usuarios** (permiso `users.read`; crear y editar exige `users.manage`):

- **Lista:** busca por nombre, usuario o correo y filtra por estado (por defecto, solo activos), rol y sucursal. Toca un usuario para ver su ficha.
- **Nuevo usuario:** al escribir el nombre se sugiere el usuario (`Juan Pérez` → `jperez`, o `jperez2` si ya existe); se puede cambiar antes de guardar y después ya no. Eliges rol, sucursales (con una predeterminada) y, si tienes `users.permissions`, permisos extra además de los del rol.
- **Contraseña:** al crear o restablecer, la app la genera (12 caracteres legibles, p. ej. `k7mp-x3qa-9vtw`) o la escribes tú. La generada **se muestra una sola vez**: cópiala antes de tocar **Entendido**. En los dos casos se pedirá cambiarla al iniciar sesión.
- **Desactivar** cierra todas las sesiones del usuario y le impide entrar; **Reactivar** lo devuelve. **Restablecer contraseña** también cierra sus sesiones. Los cambios de rol, sucursales o permisos se aplican en su siguiente renovación de sesión (como máximo 15 min).
- **Límites:** nadie otorga un rol, permiso o sucursal que no tiene, ni modifica a alguien con permisos que él no tiene (por eso un Gerente no crea Administradores). Nadie cambia su propio rol, permisos, sucursales ni estado; en tu ficha solo editas nombre, correo y teléfono. Toda acción queda en el audit, nunca con contraseñas.

**El Propietario** (`owner`) tiene siempre todos los permisos, es único y solo él modifica su cuenta: ni un Administrador puede editarlo, desactivarlo ni restablecer su contraseña, y el rol Propietario no se asigna desde la app.

**Contraseña olvidada del Propietario:** en el servidor, con acceso a la BD:

```bash
pnpm owner:reset-password
```

Imprime una contraseña temporal (una sola vez), cierra todas sus sesiones y le pide cambiarla al entrar. Solo necesita `DATABASE_URL` (en desarrollo la toma de `.env`). Si no hay Propietario, avisa que primero corras `pnpm db:seed` y no cambia nada.

### Instalar la app (PWA)

La app se instala desde el navegador, sin tienda. En `pnpm dev` el service worker no se activa; para probar la instalación usa la versión compilada, que también sirve por HTTPS con los certificados de mkcert y reenvía `/api` a la API:

```bash
pnpm --filter @warehouse-manager/web build
pnpm --filter @warehouse-manager/web preview     # https://<IP-LAN>:4173
```

- **Android (Chrome):** abre la web → menú ⋮ → **Instalar app** (o **Agregar a la pantalla principal**).
- **iOS (Safari):** abre la web → botón Compartir → **Agregar a inicio**.

Se abre a pantalla completa, sin barra del navegador. Cuando hay una versión nueva, la app no se recarga sola: aparece el aviso "Hay una nueva versión disponible" y se actualiza al tocar **Actualizar** (así nunca se interrumpe una venta). Los datos (`/api`) y las fotos (`/uploads`) siempre se piden al servidor; la app no funciona sin conexión.

### Ajustes: sucursal y cajas

Módulo **Ajustes**. La pestaña **Sucursal** exige `settings.branch` y la pestaña **Cajas**, `settings.registers`; solo se ven las que permite tu rol. Siempre se edita la sucursal con la que trabajas (la del menú de usuario).

- **Sucursal:** nombre, razón social, RFC, dirección, teléfono, correo, imágenes, textos del ticket, zona horaria, IVA y umbral de stock bajo. El código (prefijo de los folios) y la moneda (MXN) no se editan. Vaciar un campo lo borra. Solo se guardan los campos que cambiaste, y cada cambio queda en el audit con el valor anterior y el nuevo.
- **IVA y zona horaria:** el IVA se escribe en % (`16`, `16.5`) y, como "Los precios incluyen IVA", solo aplica a ventas nuevas; cada venta guarda su copia. Cambiar la zona horaria cambia cómo se agrupan por día las ventas en reportes y cortes, también las anteriores.
- **Vista previa del ticket:** a la derecha en escritorio y con **Vista previa** en el celular. Muestra tus cambios mientras escribes, antes de guardar, en papel de 80 o 58 mm, con partidas de ejemplo. **Imprimir prueba** la manda a la impresora (en la TM-T20III, papel de 80 mm, márgenes "Ninguno" y escala 100 %).
- **Cajas:** se editan el código (único en la sucursal) y el nombre; no se agregan ni se eliminan.

**Logo y foto:** en **Imágenes**, toca **Cambiar** y elige un JPG, PNG o WebP de hasta 10 MB. Se sube de inmediato (se guarda en WebP), pero queda en la sucursal hasta que pulsas **Guardar**. **Quitar** lo borra al guardar. El logo va en el encabezado del ticket; la foto solo se ve en Ajustes. Para el ticket conviene un logo en blanco y negro, sin fondo y más ancho que alto.

**QR de promoción:** se arma con dos campos del bloque **Ticket**:

- **Texto del QR:** lo que lleva el QR. Si es un enlace (`https://…` o `www.…`), el celular del cliente lo abre al escanearlo. Cualquier otro texto, como un código de descuento (`DESC10`), viaja como `PROMO:DESC10`: al escanearlo en el sistema se reconoce como promoción y el POS muestra el código, pero el descuento lo aplica el cajero a mano (con `pos.discount`); el sistema no lo valida.
- **Descripción del QR:** se imprime debajo del QR (por ejemplo, "Muestra este QR en tu próxima compra").
- Con solo la descripción se imprime como mensaje, sin QR; sin ninguno de los dos, no se imprime nada.

### Productos

Módulo **Productos** (`products.read`; crear y editar exige `products.manage`).

- **Buscar:** escanea un código (SKU de variante, código de barras o SKU padre) para abrir el producto, o busca por SKU, nombre o marca y filtra por estado, tipo y categoría.
- **Alta y edición:**
  - Un producto **simple** tiene una sola variante con su mismo SKU y, opcionalmente, código de barras.
  - Uno **con variantes** se arma con el generador: escribe tallas, colores o materiales y toca **Generar combinaciones**. Se crean las que falten, con el SKU sugerido (`ZAP0101` + 25.5 + Negro → `ZAP0101-255-NEG`); el SKU se puede editar.
  - La categoría (`Calzado > Dama`, hasta 3 niveles) y la marca se escriben o se eligen; si no existen, se crean al guardar.
  - Los precios se capturan en pesos. Un precio de variante vacío usa el del producto.
- **Historial:** un producto o variante con movimientos o ventas no se borra ni cambia de tipo; se **desactiva**. Sin historial, **Eliminar** lo borra.
- **Imágenes:** hasta 10 por producto, con **Tomar foto** (cámara del celular) o **Subir archivo**. La primera es la principal; se reordenan con ↑↓ y se pueden asignar a una variante (la variante usa sus imágenes; si no tiene, las del producto).

**Carga masiva** (`/products/import`, permiso `products.import`, solo en computadora):

1. **Descargar plantilla**: hojas `Productos` (los 15 encabezados), `Instrucciones`, `Categorías` y `Marcas`.
2. Llena una fila por variante (las filas con el mismo `sku_padre` forman un producto) e **Importar .xlsx** (hasta 5 MB y 2 000 filas). También puedes pegar desde Excel en el editor. **Duplicar fila** copia la fila seleccionada justo debajo, sin `sku_variante`, para capturar rápido las variantes de un producto.
3. Las celdas con error se marcan en rojo al momento. **Validar en servidor** revisa además SKUs tomados, ubicaciones, permisos y capacidad, y muestra el resumen.
4. **Aplicar** se habilita solo tras validar sin errores. Se aplica todo o nada.

Reglas de la carga:

- Al actualizar, una celda vacía no cambia el valor y `-` borra un opcional (`costo`, `categoría`, `marca`, `talla`, `color`, `material`, `precio_variante`).
- **Existencia:** suma unidades. Si la variante ya tenía stock, hay que confirmarlo en el resumen. Exige también `inventory.putaway`.
- **Ubicación:** vacía = staging del almacén. Exceder la capacidad de un rack exige `inventory.override_capacity` y marcar "Permitir exceder capacidad".

**Etiquetas** (`/products/labels`, permiso `products.labels`): agrega variantes escaneando o buscando, indica la cantidad de cada una, elige el formato y **Imprimir**.

| Formato         | Contenido                                                                          | Impresora        |
| --------------- | ---------------------------------------------------------------------------------- | ---------------- |
| 50×25 mm        | QR del SKU, nombre, variante, SKU y precio opcional (sin imagen)                   | Ribetec RT-420ME |
| 4×6"            | Imagen, nombre, variante, precio opcional y código de barras grande                | Ribetec RT-420ME |
| Hoja A4 o Carta | 24 por hoja (3×8) con imagen, nombre, variante, precio opcional y código de barras | Impresora normal |

En el diálogo de impresión: márgenes "Ninguno" y escala 100 % (ver [Impresión](#impresión-tickets-y-etiquetas)).

### Almacén

Módulo **Almacén** (`warehouse.read`). El inicio muestra solo los accesos que permite tu rol; **Staging** indica cuántas piezas faltan por ubicar. Siempre se trabaja con el almacén de la sucursal elegida.

**Configurar** (`warehouse.manage`):

- **+ Zona**, **+ Contenedor** y **+ Rack** crean un nivel; sin código se usa el siguiente libre (zonas `A`, `B`…; contenedores y racks `01`…`99`). **Crear en lote** arma N contenedores con M racks de la misma capacidad, y **Racks en lote** agrega N racks a un contenedor.
- **Color:** se elige de una paleta de 10 colores con nombre (la térmica imprime el nombre). Un rack sin color usa el de su zona. **Prioridad** de zona: menor = preferida al sugerir ubicaciones.
- **Editar código** recalcula los códigos de ubicación de todo lo que está debajo (`A-01-03` → `D-01-03`). Antes pide confirmar: hay que reimprimir esas etiquetas, y si reutilizas un código viejo, las etiquetas viejas apuntarán al rack nuevo.
- **Capacidad** menor que lo que ya hay: se guarda con aviso, el rack se ve en rojo y no recibe más stock salvo con `inventory.override_capacity`.
- **Desactivar** solo si nada debajo tiene stock (si no, avisa en qué ubicaciones), y desactiva todo lo que contiene. **Reactivar** es nivel por nivel, de arriba hacia abajo. **Eliminar** solo si nunca tuvo movimientos.
- El **staging** (`STG-01-01`) es fijo: no se edita ni se le agrega estructura. No tiene límite y no cuenta en los totales.

**Mapa:** ocupación del almacén, de cada zona, contenedor y rack (verde < 70 %, ámbar 70–90 %, rojo > 90 %). Los filtros **Agotado**, **Bajo**, **En piso** y **Staging** marcan cuántas variantes coinciden en cada nivel. Toca un rack para ver su contenido.

**Buscar:** escanea un producto para ver en qué ubicaciones está (staging al final) y, con `inventory.other_branches.read`, cuántas hay disponibles en las otras sucursales, con su teléfono. Escanear una ubicación muestra su contenido.

**Ubicar** (`inventory.putaway`), con una mano y sin teclear:

- **Producto primero:** escanea el producto, toca una sugerencia ("A-01-01 · 30 libres · ya está aquí") o escanea la ubicación, ajusta la cantidad con − / + y elige el origen: **Desde staging** (por defecto si hay piezas ahí) o **Mercancía nueva**. **Confirmar**.
- **Ubicación primero:** escanea la ubicación y luego los productos sin parar (cada lectura suma 1); revisa la lista y **Confirmar lote**. El lote se aplica todo o nada.
- **Staging** lista lo pendiente; **Ubicar** abre "producto primero" con esa variante.

**Reubicar** (`inventory.relocate`): escanea el origen, marca los productos y sus cantidades (o **Todo**), escanea el destino y **Confirmar**. "Todo" mueve solo lo disponible: lo que está en piso se queda. Solo dentro del mismo almacén; se puede mandar a staging.

Si un rack no tiene espacio aparece "A-01-02 no tiene espacio (38/40, entran 2)": con `inventory.override_capacity` puedes **Exceder capacidad** (queda marcado en el kardex); si no, **Elegir otra ubicación**.

**Ajustar** (`inventory.adjust`): desde el acceso **Ajustar**, desde Buscar o desde el contenido de un rack. Elige entrada o salida, cantidad, motivo (Conteo físico, Merma o daño, Extravío, Hallazgo, Error de captura u Otro) y una nota obligatoria. Una salida solo toma piezas disponibles. Queda en el kardex y en el audit.

**Kardex** (`inventory.movements.read`): todos los movimientos de la sucursal, del más reciente al más antiguo, con filtros por SKU (de variante o padre), ubicación, tipo, usuario y fechas. Las fechas y los filtros "Desde/Hasta" usan la zona horaria de la sucursal.

**Etiquetas de ubicación** (`warehouse.labels`): elige el alcance (todo el almacén, zonas, contenedores o racks) y el formato; los racks inactivos solo salen si los eliges uno por uno. Máximo 500 por impresión.

| Formato         | Contenido                                                                            | Impresora                  |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| 4×6"            | QR grande, código muy grande, franja negra con el nombre del color, zona y capacidad | Ribetec RT-420ME           |
| 50×25 mm        | QR y código                                                                          | Ribetec RT-420ME           |
| Hoja A4 o Carta | 10 por hoja (2×5) con QR, código, zona, capacidad y banda en su color real           | Impresora normal (a color) |

El QR contiene `LOC:A-01-03`: cualquier campo de escaneo lo reconoce como ubicación.

### Prueba de escáner e impresión (`/dev/scanner`)

Menú de usuario → **Probar escáner**. Sirve para verificar en la tienda la cámara, el lector y la impresora de etiquetas:

- **Cámara:** toca el ícono de cámara junto al campo. Requiere HTTPS (si no, el botón dice "La cámara requiere HTTPS") y el permiso de cámara del navegador. Lee Code128, EAN-13 y QR; al leer vibra (en Android) y suena un beep. La linterna aparece solo si el celular la permite.
- **Lector:** escanea con el cursor en el campo o en cualquier parte de la página (fuera de otros campos de texto).
- **Teclado:** escribe el código y pulsa Enter.

La página muestra las últimas 10 lecturas (hora, origen, tipo y código), el código de barras o QR de la última, e **Imprimir etiqueta de prueba** (50×25 mm).

### Lector de códigos (USB o Bluetooth)

El lector funciona como un teclado: no necesita driver ni configuración en la app.

- **Por cable USB:** conéctalo a la PC.
- **Por Bluetooth con receptor USB:** conecta el receptor a la PC y vincúlalo con el código de emparejamiento de su manual (si no viene vinculado de fábrica).

El lector debe enviar **Enter** al final de cada lectura (casi todos lo hacen de fábrica; si no, actívalo con el código "Add CR suffix" o "Enter" de su manual). Si los guiones o los dos puntos salen como otro carácter (por ejemplo `ZAP0101'25'NEG`), el idioma de teclado del lector no coincide con el del equipo: configúralo con el código de su manual (p. ej. "Spanish Latin America", o "US" si Windows usa teclado en inglés).

### Impresión (tickets y etiquetas)

Las impresoras se instalan como impresoras normales de Windows con el driver del fabricante, y la app imprime con el diálogo de impresión del navegador.

- **Epson TM-T20III (tickets):** con el driver de Epson, deja como tamaño de papel el rollo de **80 mm** (o el de 58 mm si usas ese papel). El largo del ticket lo pone el driver; la app solo fija el ancho (72 mm de área imprimible en papel de 80 mm, 48 mm en papel de 58 mm).
- **Ribetec RT-420ME (etiquetas):** en las preferencias del driver, crea los tamaños **50 × 25 mm** y **4 × 6"** (102 × 152 mm), elige el sensor de separación (_gap_) si usas etiquetas troqueladas y calibra la impresora después de cargar un rollo nuevo.

En el diálogo de impresión del navegador (Chrome), en **Más opciones**:

- **Márgenes:** Ninguno.
- **Escala:** 100 % (Predeterminada).
- **Encabezados y pies de página:** desactivados.
- **Tamaño del papel:** el de la impresora (rollo de 80 mm, etiqueta de 50 × 25 mm o 4 × 6"), si el diálogo lo muestra.

Para comprobarlo, imprime la etiqueta de prueba de `/dev/scanner` en la RT-420ME y léela con la cámara y con el lector.

## Pruebas

`pnpm test` corre los tests de los tres paquetes. Los de integración de la API usan la BD de pruebas (`TEST_DATABASE_URL`, puerto 5433), así que **requieren `pnpm dev:db`**. Antes de correr, borran esa BD y le aplican las migraciones; por seguridad se niegan a correr si `TEST_DATABASE_URL` no termina en `_test` o si es igual a `DATABASE_URL`.

```bash
pnpm --filter @warehouse-manager/api test:unit   # sin BD
pnpm --filter @warehouse-manager/api test:int    # solo integración
```

## HTTPS en desarrollo (para usar la cámara del celular)

El navegador del celular solo permite la cámara en HTTPS. Con mkcert se crea una autoridad certificadora (CA) local y certificados confiables para tu PC:

1. Instala mkcert:
   - Windows: `winget install FiloSottile.mkcert` (o `choco install mkcert`).
   - macOS: `brew install mkcert`.
   - Linux: ver <https://github.com/FiloSottile/mkcert#installation>.
2. Instala la CA en tu PC (una sola vez): `mkcert -install`.
3. Genera los certificados: `pnpm dev:certs`. Detecta la IP LAN de tu PC; si elige otra, pásala: `pnpm dev:certs 192.168.1.50`. Los archivos quedan en `infra/certs/` (no se versionan).
4. Reinicia `pnpm dev`. Vite arranca en HTTPS; si no encuentra los certificados, arranca en HTTP y lo avisa en consola.

### Abrir la web desde el celular

1. El celular debe estar en la misma red Wi-Fi que la PC.
2. Instala la CA de mkcert en el celular (pasos abajo).
3. Abre `https://<IP-LAN-de-tu-PC>:5173` (el comando `pnpm dev:certs` la muestra al terminar).
4. En Windows, si no carga, permite Node.js en el Firewall de Windows para redes privadas.
5. Si después de instalar la CA sigue diciendo "No seguro", cierra el navegador por completo (desde las apps recientes) y vuelve a abrirlo: guarda el error del primer intento.

### Instalar la CA de mkcert en el celular

El archivo de la CA es `rootCA.pem`, dentro de la carpeta que muestra `mkcert -CAROOT`. Pásalo al celular (correo, cable o nube). **No compartas `rootCA-key.pem`**: es la llave privada de la CA.

- **Android:** Ajustes → Seguridad → Más ajustes de seguridad → Cifrado y credenciales → Instalar un certificado → Certificado de CA → elige `rootCA.pem`. (La ruta exacta cambia según la marca; busca "certificado de CA" en Ajustes.) Chrome confía en las CA instaladas por el usuario.
- **iOS:** abre `rootCA.pem` desde Archivos o el correo → Ajustes → Perfil descargado → Instalar. Luego Ajustes → General → Información → Ajustes de confianza de certificados → activa la CA de mkcert.

## Calidad

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc -b en todo el monorepo
pnpm test        # Jest en shared, api y web
pnpm build       # shared → api → web
pnpm format      # Prettier
```

Un _pre-commit_ (husky + lint-staged) corre ESLint y Prettier sobre los archivos del commit.
