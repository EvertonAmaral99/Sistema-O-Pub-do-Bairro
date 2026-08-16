ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales(customer_id) WHERE customer_id IS NOT NULL;

UPDATE sales s
SET customer_id=linked.customer_id
FROM (
  SELECT sale_id,MIN(customer_id) AS customer_id
  FROM payments
  WHERE method='STORE_CREDIT' AND customer_id IS NOT NULL
  GROUP BY sale_id
  HAVING COUNT(DISTINCT customer_id)=1
) linked
WHERE linked.sale_id=s.id AND s.customer_id IS NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by BIGINT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE INDEX IF NOT EXISTS payments_active_sale_idx
  ON payments(sale_id,id) WHERE voided_at IS NULL;

UPDATE stock_pools
SET name='CHOPP PILSEN — BARRIL 50 L',updated_at=NOW()
WHERE stock_kind='DRAFT_BEER';

UPDATE stock_pools
SET name='CHOPP VINHO — BARRIL 30 L',updated_at=NOW()
WHERE stock_kind='DRAFT_WINE';

UPDATE products p
SET name=REGEXP_REPLACE(p.name,'(CHOPP|CHOPE)[[:space:]]+CERVEJA','CHOPP PILSEN','gi'),updated_at=NOW()
WHERE p.stock_pool_id=(SELECT id FROM stock_pools WHERE stock_kind='DRAFT_BEER')
  AND p.name ~* '(CHOPP|CHOPE)[[:space:]]+CERVEJA';
