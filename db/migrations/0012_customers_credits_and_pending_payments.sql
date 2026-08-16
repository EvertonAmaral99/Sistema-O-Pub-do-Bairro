CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL UNIQUE,
  contact TEXT NOT NULL,
  store_credit_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (store_credit_balance_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(LOWER(name));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('CASH','PIX','DEBIT','CREDIT','STAFF_VOUCHER','STORE_CREDIT'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE payments p SET created_at=s.created_at FROM sales s WHERE s.id=p.sale_id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_member_name TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_voucher_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_voucher_settlement_type TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_voucher_settled_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_voucher_settled_by BIGINT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_voucher_settlement_note TEXT;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_staff_voucher_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_staff_voucher_status_check
  CHECK (staff_voucher_status IS NULL OR staff_voucher_status IN ('PENDING','SETTLED','CANCELLED'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_staff_voucher_settlement_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_staff_voucher_settlement_type_check
  CHECK (staff_voucher_settlement_type IS NULL OR staff_voucher_settlement_type IN ('PAID','PAYROLL_DISCOUNT'));
CREATE INDEX IF NOT EXISTS payments_staff_pending_idx ON payments(staff_voucher_status,id)
  WHERE method='STAFF_VOUCHER';
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments(customer_id) WHERE customer_id IS NOT NULL;

UPDATE payments p
SET staff_voucher_status=CASE WHEN s.status='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
    staff_member_name=COALESCE(NULLIF(BTRIM(p.staff_member_name),''),'Funcionário não informado')
FROM sales s
WHERE s.id=p.sale_id AND p.method='STAFF_VOUCHER' AND p.staff_voucher_status IS NULL;

CREATE TABLE IF NOT EXISTS customer_credit_movements (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('CREDIT_GRANTED','SALE_USED','SALE_REFUNDED','ADJUSTMENT')),
  sale_id BIGINT REFERENCES sales(id),
  payment_id BIGINT REFERENCES payments(id),
  notes TEXT,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_credit_movements_customer_idx
  ON customer_credit_movements(customer_id,created_at DESC);

ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check
  CHECK (permission IN ('DASHBOARD','COMMANDS','KITCHEN','PRODUCTS','STOCK','CASH','REPORTS','FINANCE','CUSTOMERS'));

INSERT INTO user_permissions (user_id,permission)
SELECT id,'CUSTOMERS' FROM users WHERE role IN ('ADMIN','MANAGER','CASHIER')
ON CONFLICT DO NOTHING;
