ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','MANAGER','CASHIER','KITCHEN','WAITER'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','PIX','DEBIT','CREDIT','STAFF_VOUCHER'));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sale_unit TEXT NOT NULL DEFAULT 'UNIT';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_unit_check;
ALTER TABLE products ADD CONSTRAINT products_sale_unit_check CHECK (sale_unit IN ('UNIT','KG','L','PORTION','DOSE','BOTTLE','CAN'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sale_unit TEXT NOT NULL DEFAULT 'UNIT';
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_sale_unit_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_sale_unit_check CHECK (sale_unit IN ('UNIT','KG','L','PORTION','DOSE','BOTTLE','CAN'));

ALTER TABLE products ALTER COLUMN stock_quantity TYPE NUMERIC(12,3) USING stock_quantity::numeric;
ALTER TABLE products ALTER COLUMN min_stock TYPE NUMERIC(12,3) USING min_stock::numeric;
ALTER TABLE order_items ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::numeric;
ALTER TABLE stock_movements ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::numeric;

ALTER TABLE commands ADD COLUMN IF NOT EXISTS cancelled_by BIGINT REFERENCES users(id);
ALTER TABLE commands ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS split_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_split_count_check;
ALTER TABLE sales ADD CONSTRAINT sales_split_count_check CHECK (split_count > 0);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_hours NUMERIC(6,2) NOT NULL CHECK (duration_hours > 0),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  created_by BIGINT NOT NULL REFERENCES users(id),
  updated_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date, start_time);
