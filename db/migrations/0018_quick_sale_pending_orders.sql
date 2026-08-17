CREATE TABLE IF NOT EXISTS quick_sale_pending_orders (
  id BIGSERIAL PRIMARY KEY,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  checkout_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NOT NULL REFERENCES users(id),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  legacy_user_id BIGINT UNIQUE REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(items) = 'array'),
  CHECK (jsonb_typeof(checkout_state) = 'object')
);

CREATE INDEX IF NOT EXISTS quick_sale_pending_orders_updated_idx
  ON quick_sale_pending_orders(updated_at DESC);

INSERT INTO quick_sale_pending_orders (items,checkout_state,created_by,updated_by,legacy_user_id,created_at,updated_at)
SELECT items,'{}'::jsonb,user_id,user_id,user_id,updated_at,updated_at
FROM quick_sale_drafts
WHERE jsonb_array_length(items) > 0
ON CONFLICT (legacy_user_id) DO NOTHING;
