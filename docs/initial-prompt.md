Vamos a planificar el diseño y plan de implementacion de un mvp de una aplicación de gestión de sucursales/almacenes y punto de venta para una empresa/cliente que vende calzados, bolsos, accesorios, entre otros productos orientado principalmente a dispositivos moviles:

## Descripción general de lo que el cliente espera de la aplicación: Una aplicación web que le permita gestionar y operar el sistema principalmente mediante dispositivos móviles sus diferentes sucursales/almacenes, ubicar productos en ubicaciones, obtener ubicación de un producto en especifico, sugerir ubicaciones de acuerdo a rotacion del producto, transferir productos entre sucursales, reubicar productos en el almacen.  Gestionar usuarios, crear, editar, desactivar, otorgar permisos, monitorear ventas, conectar stock con plataformas externas de e-commerce como woocomerce para poder unificar su inventario del e-commerce y poder sincronizar ambos inventarios, gestionar productos, crear/editar/borrar o desactivar productos, cargar inventario inicial masivo mediante plantillas de Excel, gestionar proveedores, ordenes de surtido/compra a proveedores, portal de proveedores para consultar sus pedidos, confirmar el envió/surtido de el/los productos, portal de clientes para ver sus compras, pedidos en linea. el cliente desea poder agregar más funcionalidades en un futuro.

## Descripción a grandes rasgos de los requisitos por modulo:

-Login: formulario de inicio de sesión con usuario y contraseña.

-Productos: carga de productos masivos mediante Excel o una tabla editable tipo Excel para cargar varios productos a la vez, creación de nuevos productos, edición de productos existentes, productos con variantes como talla/color/material
productos con sku único, si el producto es variable las variantes están ligadas al sku del producto padre, cada variante tiene un sku único. se le debe poder cargar imágenes al producto. se debe poder generar etiqueta con código de barras del sku del producto
imagen del producto, nombre y variante si las tiene.

-Usuarios: creación de usuarios, asignación de permisos a los usuarios, asignación de sucursal a los usuarios, asignación de credenciales de acceso de los usuarios, edición de usuarios, desactivación de usuarios.

-Proveedores: creación de proveedores, edición de proveedores, crear orden de resurtido/compra, portal de proveedores para que los proveedores puedan consultar sus pedidos y confirmar que han recibido la orden surtido, agregar observaciones o dudas, marcar como despachado/enviado y el usuario pueda completar el pedido marcando como recibido, se debe poder saber quien recibió la mercancía en sucursal/almacén

-Sucursales, crear sucursal, cargar datos de la sucursal, cargar recibo que tendrán los tickets de venta de esa sucursal, imagen de la sucursal, activar/desactivar sucursal, configurar mensaje en el ticket, cargar QR de promoción especial,

-Almacen/inventario: El almacen es el inventario de la sucursal, esta ubicado en alguna sucursal, el almacen se compone de zonas. las zonas tienen contenedores, los contenedores tienen racks, los racks tienen productos, se debe
poder buscar la ubicación de un producto por medio de su sku, se debe poder ver los sku que contiene un rack, un contenedor, una zona, y todo el almacen, se debe poder monitorear la capacidad de cada rack y visualizar la capacidad ocupada
derivar la capacidad del contenedor, y de todo el almacen, se debe poder escanear el código del producto y seleccionar las ubicaciones disponibles para almacenar, se debe poder escanear el código de la ubicación y poder asignar productos mediante escaneo del producto o tecleo del sku, se debe poder reubicar productos
escaneando ubicacion de origen y destino, el sistema debe poder generar QR del código de la ubicación, el cleinte propone "Zona-Contenedor-Rack-EtiquetaColor" ejemplo: "ZA-C1-R1-EA" que seria Zona A-contenedor1-Rack1-EtiquetaAmarilla, aquí puedes proponerme otras alternativas que
sea más rápidas de ubicar.

### Punto de venta: Vender productos, atender a clientes, el flujo de atención sería el siguiente, el cliente solicita ver producto el vendedor escanea o teclea el sku del producto, obtiene ubicaciones y existencias, trae el producto, el cliente puede solicitar otra talla o producto
el vendedor repite el proceso, el cliente puede llevar todos o descartar algunos o todos, el zapato descartado por el cliente puede ser devuelto inmediatamente al almacen en su ubicacion en la que estaba, o puede ser puesto en un area de stagin para ser reacomodado despues, si el cliente se lleva algun producto se procesa una venta y el producto
sale del inventario. debe poder imprimir tickets de venta,

### Reportes: Reporte de venta con las ventas del día por defecto, filtro de fechas por rango de fechas con totales.

Para este MVP se necesita poder: iniciar sesion, gestionar usuarios, Gestionar el almacen, vender productos.

Se pretende usar el celular principalmente como scanner de códigos para la gestion de productos en el almacen pero debe funcionar con lector de códigos de igual forma.

Para este primer MVP lo que hay que entregar por modulo:

### Login:
-Inicio de sesion con usuarios y contraseña.
-Cerrar sesion

### Usuarios:
-Crear/editar/desactivar usuarios
-generar credenciales de acceso usuario y contraseña
-asignar sucursales a usuarios
-asignar permisos a usuarios

Alamcen/sucursal:
-Mapa de productos con srtock y estado del prodcuto
-Ubicar productos
-ver capacidad/Estado usada/disponible del almacen y sus contenedores, racks.
-reasignar productos
-crear nuevas zonas crearle contenedores a la zona, crearle racks al contenedor.
-generar QR de ubicaciónes.

### Productos:
-Carga masiva de productos mediante tabla editable tipo excel/shopify
-Crear/actualizar/desactivar productos
-Generar código de barra del producto con imagen del producto

### Pos:
-Abrir caja
-buscar producto
-agregar al carrito
-suspender carrito (hasta 5 carritos)
-vender productos.
-imprimir ticket.

### Reportes:
-> Ventas: Ventas por rango de fecha por defecto día actual con totales.

### Ajustes:
-> Sucursales: por defecto 1 sola sucursal (editar datos solamente).
-> Cajas: por defecto 2 Cajas (Editar datos solamente y asignadas a la sucursal 1).

## Detalles técnicos
Lenguaje de programación: Typescript.
Frontend: React con vite y Typescript.
Backend: Nodejs con typescript.
Base de datos: PostgreSQL,
Infraestructura: Docker,
host en vps o servidor local de la empresa.
Proxy server con Ngnx,
tests: jest
Documentacion de la api con swagger.
Autenticacion con JWT y refresh tokens con httponly y cookies.
Validaciones con Zod.

los datos deben estar bien definidos entre la BD, el backend y el frontend.

Genera el archivo `docs/paln/plan.md` detallando las fases de implementación del proyecto, partiendo desde el modelado de los datos hasta la UI, todavía no generes código aun, vamos a detallar primero
el plan y despues generaremos las specs con las todos para poder desarrollar este proyecto por fases.
