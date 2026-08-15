ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_cost_cents_check;
ALTER TABLE products ADD CONSTRAINT products_cost_cents_check CHECK (cost_cents >= 0);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_unit_cost_cents_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_unit_cost_cents_check CHECK (unit_cost_cents >= 0);

UPDATE order_items oi
SET unit_cost_cents=p.cost_cents
FROM products p
WHERE p.id=oi.product_id AND oi.unit_cost_cents=0 AND p.cost_cents>0;

ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check
  CHECK (permission IN ('DASHBOARD','COMMANDS','KITCHEN','PRODUCTS','STOCK','CASH','REPORTS','FINANCE'));

INSERT INTO user_permissions (user_id,permission)
SELECT id,'FINANCE' FROM users WHERE role IN ('ADMIN','MANAGER')
ON CONFLICT DO NOTHING;
