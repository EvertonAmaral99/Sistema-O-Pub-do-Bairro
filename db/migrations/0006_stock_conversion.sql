ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_per_sale_unit NUMERIC(12,3) NOT NULL DEFAULT 1;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_per_sale_unit_check;
ALTER TABLE products ADD CONSTRAINT products_stock_per_sale_unit_check CHECK (stock_per_sale_unit > 0);

UPDATE products
SET stock_per_sale_unit = ROUND((REPLACE(substring(name from '([0-9]+[.,]?[0-9]*)[[:space:]]*[mM][lL]'), ',', '.')::numeric / 1000), 3)
WHERE sale_unit = 'L'
  AND name ~* '[0-9]+[.,]?[0-9]*[[:space:]]*ml'
  AND REPLACE(substring(name from '([0-9]+[.,]?[0-9]*)[[:space:]]*[mM][lL]'), ',', '.')::numeric > 0;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_quantity_used NUMERIC(12,3);
UPDATE order_items SET stock_quantity_used = quantity WHERE stock_quantity_used IS NULL;
ALTER TABLE order_items ALTER COLUMN stock_quantity_used SET NOT NULL;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS display_unit TEXT NOT NULL DEFAULT 'UNIT';
UPDATE order_items SET display_unit = sale_unit;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_display_unit_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_display_unit_check CHECK (display_unit IN ('UNIT','KG','L','PORTION','DOSE','BOTTLE','CAN'));
