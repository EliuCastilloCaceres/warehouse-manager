
## Proyecto
warehouse-manager es un sistema web mobile-first (PWA) para una empresa de calzado, bolsos y accesorios: opera sucursal/almacén y punto de venta desde el celular (ubicar stock, reubicar, vender).

Es un monorepo pnpm con TypeScript estricto: SPA React + Vite (apps/web), API Fastify modular (apps/api) sobre PostgreSQL 16 + Prisma, contratos compartidos en Zod (packages/shared), y despliegue con Docker Compose + Nginx.

El MVP cubre login/usuarios, mapa de almacén, productos (carga masiva), POS, reportes de ventas y ajustes de sucursal/cajas; lo demás (proveedores, WooCommerce, multi-sucursal completa) queda fuera, solo como extensión del modelo.


## Estilo y convenciones
-Identificadores en inglés; mensajes de usuario en español.

## Reglas
- Lee docs/constitution.md y la spec en progreso antes de tocar código.
- No modifiques archivos dentro de `specs/` salvo petición explícita.

## Al terminar cualquier tarea
- Ejecuta los test y confirma en tu respuesta que todo pasa.