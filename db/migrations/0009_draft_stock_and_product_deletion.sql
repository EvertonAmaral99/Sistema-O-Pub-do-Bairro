ALTER TABLE stock_pools ADD COLUMN IF NOT EXISTS stock_kind TEXT;
ALTER TABLE stock_pools DROP CONSTRAINT IF EXISTS stock_pools_stock_kind_check;
ALTER TABLE stock_pools ADD CONSTRAINT stock_pools_stock_kind_check
  CHECK (stock_kind IS NULL OR stock_kind IN ('DRAFT_BEER','DRAFT_WINE'));

CREATE UNIQUE INDEX IF NOT EXISTS stock_pools_stock_kind_unique_idx
  ON stock_pools(stock_kind)
  WHERE stock_kind IS NOT NULL;

UPDATE stock_pools
SET stock_kind='DRAFT_BEER',name='CHOPP CERVEJA — GALÃO 50 L',sale_unit='L',unlimited=FALSE
WHERE id=(
  SELECT p.stock_pool_id
  FROM products p
  JOIN stock_pools candidate ON candidate.id=p.stock_pool_id
  WHERE p.name ~* '(CHOPP|CHOPE)' AND p.name ~* 'CERVEJA' AND candidate.stock_kind IS NULL
  ORDER BY p.id
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM stock_pools WHERE stock_kind='DRAFT_BEER');

UPDATE stock_pools
SET stock_kind='DRAFT_WINE',name='CHOPP VINHO — GALÃO 50 L',sale_unit='L',unlimited=FALSE
WHERE id=(
  SELECT p.stock_pool_id
  FROM products p
  JOIN stock_pools candidate ON candidate.id=p.stock_pool_id
  WHERE p.name ~* '(CHOPP|CHOPE)' AND p.name ~* 'VINHO' AND candidate.stock_kind IS NULL
  ORDER BY p.id
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM stock_pools WHERE stock_kind='DRAFT_WINE');

INSERT INTO stock_pools (name,sale_unit,stock_quantity,min_stock,unlimited,stock_kind)
SELECT 'CHOPP CERVEJA — GALÃO 50 L','L',0,5,FALSE,'DRAFT_BEER'
WHERE NOT EXISTS (SELECT 1 FROM stock_pools WHERE stock_kind='DRAFT_BEER');

INSERT INTO stock_pools (name,sale_unit,stock_quantity,min_stock,unlimited,stock_kind)
SELECT 'CHOPP VINHO — GALÃO 50 L','L',0,5,FALSE,'DRAFT_WINE'
WHERE NOT EXISTS (SELECT 1 FROM stock_pools WHERE stock_kind='DRAFT_WINE');

UPDATE products
SET stock_pool_id=(SELECT id FROM stock_pools WHERE stock_kind='DRAFT_BEER'),
    sale_unit='L',
    stock_per_sale_unit=CASE
      WHEN name ~* '300[[:space:]]*ml' THEN 0.300
      WHEN name ~* '500[[:space:]]*ml' THEN 0.500
      ELSE stock_per_sale_unit
    END
WHERE name ~* '(CHOPP|CHOPE)' AND name ~* 'CERVEJA';

UPDATE products
SET stock_pool_id=(SELECT id FROM stock_pools WHERE stock_kind='DRAFT_WINE'),
    sale_unit='L',
    stock_per_sale_unit=CASE
      WHEN name ~* '300[[:space:]]*ml' THEN 0.300
      WHEN name ~* '500[[:space:]]*ml' THEN 0.500
      ELSE stock_per_sale_unit
    END
WHERE name ~* '(CHOPP|CHOPE)' AND name ~* 'VINHO';

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS products_deleted_at_idx ON products(deleted_at);
