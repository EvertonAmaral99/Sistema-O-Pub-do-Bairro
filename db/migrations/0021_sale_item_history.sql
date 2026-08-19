ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sale_id BIGINT;

UPDATE order_items oi
SET sale_id=s.id
FROM sales s
WHERE oi.sale_id IS NULL
  AND s.command_id=oi.command_id
  AND (
    oi.status<>'CANCELLED'
    OR (
      s.status='CANCELLED'
      AND oi.cancelled_at IS NOT NULL
      AND oi.cancelled_at>=s.created_at
    )
  );

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_sale_id_fkey;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales(id);

CREATE INDEX IF NOT EXISTS order_items_sale_id_idx ON order_items(sale_id);
