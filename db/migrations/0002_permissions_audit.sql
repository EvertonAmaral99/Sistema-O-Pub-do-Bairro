CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('DASHBOARD','COMMANDS','KITCHEN','PRODUCTS','STOCK','CASH','REPORTS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id, created_at DESC);

INSERT INTO user_permissions (user_id, permission)
SELECT id, unnest(
  CASE
    WHEN role IN ('ADMIN','MANAGER') THEN ARRAY['DASHBOARD','COMMANDS','KITCHEN','PRODUCTS','STOCK','CASH','REPORTS']
    WHEN role = 'CASHIER' THEN ARRAY['DASHBOARD','COMMANDS','CASH']
    ELSE ARRAY['DASHBOARD','KITCHEN']
  END
)
FROM users
ON CONFLICT DO NOTHING;
