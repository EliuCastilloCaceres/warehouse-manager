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
pnpm seed:demo    # opcional: zonas, racks y un catálogo de ejemplo (sin stock)
```

- **Contraseñas iniciales:** antes del primer `pnpm db:seed`, cambia `OWNER_INITIAL_PASSWORD` y `ADMIN_INITIAL_PASSWORD` en `.env` (mínimo 8 caracteres). Los usuarios `owner` (Propietario) y `admin` (Administrador) deberán cambiarlas al entrar. El seed nunca restablece una contraseña que ya existe.
- Los dos seeds se pueden correr las veces que quieras: solo crean lo que falta y no sobrescriben lo que hayas editado (el seed base sí sincroniza los permisos y roles del sistema).
- **Cambios al modelo:** edita `schema.prisma` y corre `pnpm db:migrate --name <descripcion>`. Después regenera el cliente con `pnpm --filter @warehouse-manager/api db:generate` (Prisma 7 ya no lo hace solo al migrar; `build`, `typecheck` y `test` lo regeneran por su cuenta).
- **Empezar de cero en desarrollo** (borra todos los datos de `warehouse_dev`): `pnpm --filter @warehouse-manager/api exec prisma migrate reset`, y luego `pnpm db:seed` (y `pnpm seed:demo` si lo quieres).

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
