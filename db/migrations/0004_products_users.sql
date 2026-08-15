ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','MANAGER','CASHIER','KITCHEN','WAITER','ATTENDANT'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_mime TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_image_mime_check;
ALTER TABLE products ADD CONSTRAINT products_image_mime_check CHECK (image_mime IS NULL OR image_mime IN ('image/jpeg','image/png','image/webp'));
