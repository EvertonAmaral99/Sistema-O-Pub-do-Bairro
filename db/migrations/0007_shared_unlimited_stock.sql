CREATE TABLE IF NOT EXISTS stock_pools (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sale_unit TEXT NOT NULL DEFAULT 'UNIT' CHECK (sale_unit IN ('UNIT','KG','L','PORTION','DOSE','BOTTLE','CAN')),
  stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  min_stock NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  unlimited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO stock_pools (id,name,sale_unit,stock_quantity,min_stock,unlimited)
SELECT p.id,p.name,p.sale_unit,p.stock_quantity,p.min_stock,FALSE
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM stock_pools sp WHERE sp.id=p.id);

SELECT setval(
  pg_get_serial_sequence('stock_pools','id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM stock_pools),0),1),
  EXISTS (SELECT 1 FROM stock_pools)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_pool_id BIGINT;
UPDATE products SET stock_pool_id=id WHERE stock_pool_id IS NULL;
ALTER TABLE products ALTER COLUMN stock_pool_id SET NOT NULL;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_pool_id_fkey;
ALTER TABLE products ADD CONSTRAINT products_stock_pool_id_fkey FOREIGN KEY (stock_pool_id) REFERENCES stock_pools(id);
CREATE INDEX IF NOT EXISTS products_stock_pool_idx ON products(stock_pool_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_pool_id BIGINT;
UPDATE order_items oi SET stock_pool_id=p.stock_pool_id FROM products p WHERE p.id=oi.product_id AND oi.stock_pool_id IS NULL;
ALTER TABLE order_items ALTER COLUMN stock_pool_id SET NOT NULL;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_stock_pool_id_fkey;
ALTER TABLE order_items ADD CONSTRAINT order_items_stock_pool_id_fkey FOREIGN KEY (stock_pool_id) REFERENCES stock_pools(id);
CREATE INDEX IF NOT EXISTS order_items_stock_pool_idx ON order_items(stock_pool_id);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS stock_pool_id BIGINT;
UPDATE stock_movements sm SET stock_pool_id=p.stock_pool_id FROM products p WHERE p.id=sm.product_id AND sm.stock_pool_id IS NULL;
ALTER TABLE stock_movements ALTER COLUMN stock_pool_id SET NOT NULL;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_stock_pool_id_fkey;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_stock_pool_id_fkey FOREIGN KEY (stock_pool_id) REFERENCES stock_pools(id);
CREATE INDEX IF NOT EXISTS stock_movements_stock_pool_idx ON stock_movements(stock_pool_id);
