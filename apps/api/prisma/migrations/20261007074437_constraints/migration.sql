-- Migración `constraints` (spec F1 §5): garantías que Prisma no expresa.
-- Escrita a mano. Una migración aplicada no se edita: los cambios van en migraciones nuevas.

-- ─── 5.1 CHECK ───────────────────────────────────────────────────────────────

ALTER TABLE "branch"
  ADD CONSTRAINT "branch_tax_rate_bp_check" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "branch_low_stock_threshold_check" CHECK ("low_stock_threshold" >= 0),
  ADD CONSTRAINT "branch_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "branch_counter"
  ADD CONSTRAINT "branch_counter_value_check" CHECK ("value" >= 0);

ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_username_lower_check" CHECK ("username" = lower("username"));

ALTER TABLE "cash_session"
  ADD CONSTRAINT "cash_session_amounts_check" CHECK (
    "opening_amount" >= 0
    AND ("expected_amount" IS NULL OR "expected_amount" >= 0)
    AND ("counted_amount" IS NULL OR "counted_amount" >= 0)
  ),
  ADD CONSTRAINT "cash_session_status_check" CHECK (
    (
      "status" = 'OPEN'
      AND "closed_by_id" IS NULL
      AND "closed_at" IS NULL
      AND "expected_amount" IS NULL
      AND "counted_amount" IS NULL
      AND "difference" IS NULL
    )
    OR (
      "status" = 'CLOSED'
      AND "closed_by_id" IS NOT NULL
      AND "closed_at" IS NOT NULL
      AND "expected_amount" IS NOT NULL
      AND "counted_amount" IS NOT NULL
      AND "difference" IS NOT NULL
      AND "difference" = "counted_amount" - "expected_amount"
    )
  );

ALTER TABLE "product"
  ADD CONSTRAINT "product_sku_check" CHECK ("sku" ~ '^[A-Z0-9-]{3,40}$'),
  ADD CONSTRAINT "product_amounts_check" CHECK ("price" >= 0 AND ("cost" IS NULL OR "cost" >= 0));

ALTER TABLE "product_variant"
  ADD CONSTRAINT "product_variant_sku_check" CHECK ("sku" ~ '^[A-Z0-9-]{3,40}$'),
  ADD CONSTRAINT "product_variant_price_override_check" CHECK ("price_override" IS NULL OR "price_override" >= 0);

ALTER TABLE "zone"
  ADD CONSTRAINT "zone_code_check" CHECK ("code" ~ '^([A-Z]{1,2}|STG)$'),
  ADD CONSTRAINT "zone_staging_code_check" CHECK ("is_staging" = ("code" = 'STG')),
  ADD CONSTRAINT "zone_color_check" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-F]{6}$');

ALTER TABLE "container"
  ADD CONSTRAINT "container_code_check" CHECK ("code" ~ '^(0[1-9]|[1-9][0-9])$');

ALTER TABLE "rack"
  ADD CONSTRAINT "rack_code_check" CHECK ("code" ~ '^(0[1-9]|[1-9][0-9])$'),
  ADD CONSTRAINT "rack_location_code_check" CHECK (
    "location_code" ~ '^([A-Z]{1,2}|STG)-(0[1-9]|[1-9][0-9])-(0[1-9]|[1-9][0-9])$'
  ),
  -- staging usa 0 y su capacidad se ignora
  ADD CONSTRAINT "rack_capacity_check" CHECK ("capacity_units" >= 0),
  ADD CONSTRAINT "rack_label_color_check" CHECK ("label_color" IS NULL OR "label_color" ~ '^#[0-9A-F]{6}$');

ALTER TABLE "stock_location"
  ADD CONSTRAINT "stock_location_qty_check" CHECK (
    "quantity" >= 0 AND "reserved_qty" >= 0 AND "reserved_qty" <= "quantity"
  );

ALTER TABLE "inventory_movement"
  ADD CONSTRAINT "inventory_movement_qty_check" CHECK ("quantity" > 0),
  -- Forma de cada tipo (spec F1 §4.5)
  ADD CONSTRAINT "inventory_movement_shape_check" CHECK (
    (
      "type" IN ('INITIAL_LOAD', 'PUTAWAY', 'ADJUSTMENT_IN', 'RETURN_TO_RACK', 'SALE_CANCEL')
      AND "from_rack_id" IS NULL
      AND "to_rack_id" IS NOT NULL
    )
    OR (
      "type" IN ('PICK', 'SALE', 'ADJUSTMENT_OUT')
      AND "from_rack_id" IS NOT NULL
      AND "to_rack_id" IS NULL
    )
    OR (
      "type" IN ('RELOCATE', 'TO_STAGING')
      AND "from_rack_id" IS NOT NULL
      AND "to_rack_id" IS NOT NULL
      AND "from_rack_id" <> "to_rack_id"
    )
  ),
  ADD CONSTRAINT "inventory_movement_reference_check" CHECK (
    ("reference_type" IS NULL) = ("reference_id" IS NULL)
  ),
  ADD CONSTRAINT "inventory_movement_adjustment_reason_check" CHECK (
    ("adjustment_reason" IS NOT NULL) = ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT'))
  );

ALTER TABLE "cart"
  ADD CONSTRAINT "cart_discount_check" CHECK ("discount" >= 0),
  ADD CONSTRAINT "cart_number_check" CHECK ("number" BETWEEN 1 AND 999);

-- Productos en bigint para que unit_price × quantity no desborde int4.
ALTER TABLE "cart_item"
  ADD CONSTRAINT "cart_item_amounts_check" CHECK (
    "quantity" > 0
    AND "unit_price" >= 0
    AND "discount" >= 0
    AND "discount" <= "unit_price"::bigint * "quantity"
  );

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_amounts_check" CHECK (
    "subtotal" >= 0
    AND "global_discount" >= 0
    AND "discount_total" >= "global_discount"
    AND "tax_total" >= 0
    AND "total" >= 0
    AND "tax_rate_bp" BETWEEN 0 AND 10000
  ),
  ADD CONSTRAINT "sale_total_check" CHECK (
    "total"::bigint = "subtotal"::bigint - "discount_total"
      + CASE WHEN "prices_include_tax" THEN 0 ELSE "tax_total" END
  ),
  ADD CONSTRAINT "sale_cancel_check" CHECK (
    (
      "status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL
      AND "cancelled_by_id" IS NOT NULL
      AND "cancel_reason" IS NOT NULL
    )
    OR (
      "status" <> 'CANCELLED'
      AND "cancelled_at" IS NULL
      AND "cancelled_by_id" IS NULL
      AND "cancel_reason" IS NULL
    )
  );

ALTER TABLE "sale_item"
  ADD CONSTRAINT "sale_item_amounts_check" CHECK (
    "quantity" > 0
    AND "unit_price" >= 0
    AND "discount" >= 0
    AND "line_total"::bigint = "unit_price"::bigint * "quantity" - "discount"
    AND "line_total" >= 0
  );

-- La suma de payment.amount = sale.total se valida en el servicio de F8.
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_cash_check" CHECK (
    ("received" IS NULL AND "change" IS NULL)
    OR ("method" = 'CASH' AND "received" >= "amount" AND "change" = "received" - "amount")
  );

-- ─── 5.2 Índices únicos especiales ───────────────────────────────────────────

CREATE UNIQUE INDEX "cash_session_one_open_per_register"
  ON "cash_session" ("cash_register_id") WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "user_branch_one_default"
  ON "user_branch" ("user_id") WHERE "is_default";

CREATE UNIQUE INDEX "cart_one_active_per_user_branch"
  ON "cart" ("branch_id", "user_id") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "cart_number_open_per_branch"
  ON "cart" ("branch_id", "number") WHERE "status" IN ('ACTIVE', 'SUSPENDED');

CREATE UNIQUE INDEX "zone_one_staging_per_warehouse"
  ON "zone" ("warehouse_id") WHERE "is_staging";

DROP INDEX "category_parent_id_name_key";
CREATE UNIQUE INDEX "category_parent_id_name_key"
  ON "category" ("parent_id", "name") NULLS NOT DISTINCT;

DROP INDEX "product_variant_product_id_size_color_material_key";
CREATE UNIQUE INDEX "product_variant_product_id_size_color_material_key"
  ON "product_variant" ("product_id", "size", "color", "material") NULLS NOT DISTINCT;

-- ─── 5.3 Kardex inmutable ────────────────────────────────────────────────────

CREATE FUNCTION "inventory_movement_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movement es inmutable';
END;
$$;

-- TRUNCATE (usado en los tests) no dispara triggers de fila.
CREATE TRIGGER "inventory_movement_immutable_trg"
  BEFORE UPDATE OR DELETE ON "inventory_movement"
  FOR EACH ROW EXECUTE FUNCTION "inventory_movement_immutable"();

-- ─── 5.4 Vista v_rack_occupancy ──────────────────────────────────────────────

CREATE VIEW "v_rack_occupancy" AS
SELECT
  r."id" AS rack_id,
  r."container_id" AS container_id,
  c."zone_id" AS zone_id,
  r."warehouse_id" AS warehouse_id,
  r."location_code" AS location_code,
  r."is_active" AS is_active,
  r."capacity_units" AS capacity_units,
  z."is_staging" AS is_staging,
  COALESCE(SUM(s."quantity"), 0)::int AS occupied_units,
  COALESCE(SUM(s."reserved_qty"), 0)::int AS reserved_units,
  (r."capacity_units" - COALESCE(SUM(s."quantity"), 0))::int AS free_units
FROM "rack" r
JOIN "container" c ON c."id" = r."container_id"
JOIN "zone" z ON z."id" = c."zone_id"
LEFT JOIN "stock_location" s ON s."rack_id" = r."id"
GROUP BY r."id", c."zone_id", z."is_staging";
