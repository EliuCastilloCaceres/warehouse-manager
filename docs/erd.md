# ERD — warehouse-manager (MVP)

Diagramas del modelo de datos de `apps/api/prisma/schema.prisma` (spec F1 §4). Se mantienen **a mano**: cualquier cambio al schema se refleja aquí en el mismo commit.

Convenciones:
- Los nombres son los de Prisma (camelCase); en la BD las tablas y columnas van en snake_case (`User` → `app_user`).
- `PK` llave primaria, `FK` llave foránea, `UK` única. "opcional" = admite `NULL`.
- El dinero va en centavos (`int`). Las fechas son `timestamptz(3)`.
- Las restricciones `CHECK`, los índices parciales, el kardex inmutable y la vista `v_rack_occupancy` están en la migración `constraints` (spec F1 §5) y no se dibujan.

## 1. Organización y seguridad

```mermaid
erDiagram
    Branch {
        uuid id PK
        string code UK "S1; prefijo de folios"
        string name
        string legalName "opcional"
        string taxId "opcional; RFC"
        string address "opcional"
        string phone "opcional"
        string email "opcional"
        string imageUrl "opcional"
        string logoUrl "opcional"
        string ticketHeader "opcional"
        string ticketFooterMessage "opcional"
        string promoQrText "opcional"
        string promoQrCaption "opcional"
        string timezone "America/Mexico_City"
        char3 currency "MXN"
        int taxRateBp "1600"
        boolean pricesIncludeTax "true"
        int lowStockThreshold "2"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    BranchCounter {
        uuid branchId PK,FK
        BranchCounterKey key PK "SALE_FOLIO"
        int value
        datetime createdAt
        datetime updatedAt
    }
    CashRegister {
        uuid id PK
        uuid branchId FK "UK con code"
        string code "C1"
        string name
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    CashSession {
        uuid id PK
        uuid cashRegisterId FK
        uuid openedById FK
        datetime openedAt
        int openingAmount
        uuid closedById FK "opcional"
        datetime closedAt "opcional"
        int expectedAmount "opcional"
        int countedAmount "opcional"
        int difference "opcional; puede ser negativa"
        CashSessionStatus status "OPEN | CLOSED"
        datetime createdAt
        datetime updatedAt
    }
    User {
        uuid id PK
        string username UK "minúsculas"
        string passwordHash "argon2id"
        string fullName
        string email "opcional"
        string phone "opcional"
        uuid roleId FK
        UserType type "STAFF"
        boolean isActive
        boolean mustChangePassword
        datetime lastLoginAt "opcional"
        datetime createdAt
        datetime updatedAt
    }
    Role {
        uuid id PK
        string code UK "OWNER, ADMIN, MANAGER, SELLER, WAREHOUSE_CLERK"
        string name
        boolean isSystem
        datetime createdAt
        datetime updatedAt
    }
    Permission {
        uuid id PK
        string code UK "products.manage"
        string module
        string description
        datetime createdAt
        datetime updatedAt
    }
    RolePermission {
        uuid roleId PK,FK "cascade"
        uuid permissionId PK,FK "cascade"
        datetime createdAt
    }
    UserPermission {
        uuid userId PK,FK
        uuid permissionId PK,FK "cascade"
        datetime createdAt
    }
    UserBranch {
        uuid userId PK,FK
        uuid branchId PK,FK
        boolean isDefault "uno por usuario"
        datetime createdAt
    }
    RefreshToken {
        uuid id PK
        uuid userId FK
        string tokenHash UK "SHA-256"
        uuid familyId
        datetime expiresAt
        datetime revokedAt "opcional"
        uuid replacedById FK,UK "opcional; rotación"
        string userAgent "opcional"
        string ip "opcional"
        datetime createdAt
    }
    AuditLog {
        uuid id PK
        uuid userId FK "opcional; null = sistema"
        string action "user.create"
        string entity "User"
        string entityId "opcional"
        json payload "opcional"
        string ip "opcional"
        datetime createdAt
    }

    Branch ||--o{ BranchCounter : "contadores"
    Branch ||--o{ CashRegister : "cajas"
    CashRegister ||--o{ CashSession : "sesiones"
    User ||--o{ CashSession : "abre"
    User |o--o{ CashSession : "cierra"
    Role ||--o{ User : "rol"
    Role ||--o{ RolePermission : ""
    Permission ||--o{ RolePermission : ""
    User ||--o{ UserPermission : "permisos extra"
    Permission ||--o{ UserPermission : ""
    User ||--o{ UserBranch : ""
    Branch ||--o{ UserBranch : ""
    User ||--o{ RefreshToken : "sesiones"
    RefreshToken |o--o| RefreshToken : "reemplazado por"
    User |o--o{ AuditLog : "autor"
```

## 2. Catálogo y almacén

```mermaid
erDiagram
    Category {
        uuid id PK
        string name "UK con parentId (NULLS NOT DISTINCT)"
        uuid parentId FK "opcional; árbol"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    Brand {
        uuid id PK
        string name UK
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    Product {
        uuid id PK
        string sku UK
        string name
        string description "opcional"
        uuid categoryId FK "opcional"
        uuid brandId FK "opcional"
        ProductType type "SIMPLE | VARIABLE"
        int price
        int cost "opcional"
        text_array tags
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    ProductVariant {
        uuid id PK
        uuid productId FK "cascade"
        string sku UK
        string barcode UK "opcional"
        string size "opcional"
        string color "opcional"
        string material "opcional"
        int priceOverride "opcional"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    ProductImage {
        uuid id PK
        uuid productId FK "cascade"
        uuid variantId FK "opcional; set null"
        string url
        string thumbUrl
        int sortOrder
        datetime createdAt
        datetime updatedAt
    }
    Warehouse {
        uuid id PK
        uuid branchId FK "UK con code"
        string code "ALM1"
        string name
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    Zone {
        uuid id PK
        uuid warehouseId FK "UK con code"
        string code "A, AB o STG"
        string name
        string color "opcional; #RRGGBB"
        boolean isStaging "una por almacén"
        int priority
        int sortOrder
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    Container {
        uuid id PK
        uuid zoneId FK "UK con code"
        string code "01-99"
        string name "opcional"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    Rack {
        uuid id PK
        uuid containerId FK "UK con code"
        uuid warehouseId FK "desnormalizado; UK con locationCode"
        string code "01-99"
        string locationCode "A-01-03"
        int capacityUnits
        string labelColor "opcional; #RRGGBB"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    StockLocation {
        uuid id PK
        uuid variantId FK "UK con rackId"
        uuid rackId FK
        int quantity
        int reservedQty
        datetime createdAt
        datetime updatedAt
    }
    InventoryMovement {
        uuid id PK
        uuid variantId FK
        uuid fromRackId FK "opcional"
        uuid toRackId FK "opcional"
        int quantity
        InventoryMovementType type
        uuid userId FK
        InventoryReferenceType referenceType "opcional; CART | SALE"
        uuid referenceId "opcional"
        string note "opcional"
        AdjustmentReason adjustmentReason "opcional; solo ajustes"
        boolean capacityOverridden
        datetime createdAt "inmutable"
    }

    Category |o--o{ Category : "subcategorías"
    Category |o--o{ Product : ""
    Brand |o--o{ Product : ""
    Product ||--o{ ProductVariant : "variantes"
    Product ||--o{ ProductImage : "imágenes"
    ProductVariant |o--o{ ProductImage : "imagen de variante"
    Branch ||--o{ Warehouse : "almacenes"
    Warehouse ||--o{ Zone : "zonas"
    Zone ||--o{ Container : "contenedores"
    Container ||--o{ Rack : "racks"
    Warehouse ||--o{ Rack : ""
    ProductVariant ||--o{ StockLocation : "existencias"
    Rack ||--o{ StockLocation : ""
    ProductVariant ||--o{ InventoryMovement : "kardex"
    Rack |o--o{ InventoryMovement : "origen"
    Rack |o--o{ InventoryMovement : "destino"
    User ||--o{ InventoryMovement : "autor"
```

## 3. Punto de venta

```mermaid
erDiagram
    Cart {
        uuid id PK
        uuid branchId FK
        uuid userId FK "un ACTIVE por usuario y sucursal"
        int number "1-999; único entre abiertos"
        CartStatus status "ACTIVE | SUSPENDED | CHECKED_OUT | DISCARDED"
        string label "opcional"
        string customerName "opcional"
        int discount "descuento global"
        datetime createdAt
        datetime updatedAt
    }
    CartItem {
        uuid id PK
        uuid cartId FK "cascade"
        uuid variantId FK
        uuid sourceRackId FK
        int quantity
        int unitPrice
        int discount
        datetime createdAt
        datetime updatedAt
    }
    Sale {
        uuid id PK
        string folio UK "S1-000123"
        uuid branchId FK
        uuid cashRegisterId FK
        uuid cashSessionId FK
        uuid sellerId FK "quien armó el carrito"
        uuid cashierId FK "quien cobró"
        uuid cartId FK,UK
        string customerName "opcional"
        int subtotal
        int globalDiscount
        int discountTotal
        int taxRateBp "copia de la sucursal"
        boolean pricesIncludeTax "copia de la sucursal"
        int taxTotal
        int total
        SaleStatus status "COMPLETED | CANCELLED"
        datetime cancelledAt "opcional"
        uuid cancelledById FK "opcional"
        string cancelReason "opcional"
        datetime createdAt
        datetime updatedAt
    }
    SaleItem {
        uuid id PK
        uuid saleId FK
        uuid variantId FK
        uuid sourceRackId FK
        string skuSnapshot
        string nameSnapshot
        string variantLabelSnapshot "opcional"
        int unitPrice
        int quantity
        int discount
        int lineTotal
        datetime createdAt
    }
    Payment {
        uuid id PK
        uuid saleId FK
        PaymentMethod method "CASH | CARD | TRANSFER"
        int amount
        int received "opcional; solo CASH"
        int change "opcional; solo CASH"
        string reference "opcional"
        datetime createdAt
    }

    Branch ||--o{ Cart : "carritos"
    User ||--o{ Cart : "vendedor"
    Cart ||--o{ CartItem : "partidas"
    ProductVariant ||--o{ CartItem : ""
    Rack ||--o{ CartItem : "origen"
    Cart ||--o| Sale : "se cobra en"
    Branch ||--o{ Sale : ""
    CashRegister ||--o{ Sale : ""
    CashSession ||--o{ Sale : ""
    User ||--o{ Sale : "vendedor"
    User ||--o{ Sale : "cajero"
    User |o--o{ Sale : "canceló"
    Sale ||--o{ SaleItem : "partidas"
    ProductVariant ||--o{ SaleItem : ""
    Rack ||--o{ SaleItem : "origen"
    Sale ||--o{ Payment : "pagos"
```
