CREATE TABLE IF NOT EXISTS delivery_orders (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  pickup_code CHAR(4) NOT NULL,
  courier_app_name TEXT,
  courier_app_code TEXT,
  status TEXT NOT NULL DEFAULT 'PREPARING'
    CHECK (status IN ('PREPARING','READY','COLLECTED','CANCELLED')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  last_failed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  ready_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  collected_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (pickup_code ~ '^[0-9]{4}$'),
  CHECK (courier_app_name IS NULL OR char_length(courier_app_name) <= 60),
  CHECK (courier_app_code IS NULL OR char_length(courier_app_code) <= 40)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_active_code_idx
  ON delivery_orders(pickup_code)
  WHERE status IN ('PREPARING','READY');

CREATE INDEX IF NOT EXISTS delivery_orders_status_updated_idx
  ON delivery_orders(status,updated_at DESC);
