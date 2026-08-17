ALTER TABLE commands ADD COLUMN IF NOT EXISTS sale_channel TEXT NOT NULL DEFAULT 'COMMAND';
ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_sale_channel_check;
ALTER TABLE commands ADD CONSTRAINT commands_sale_channel_check
  CHECK (sale_channel IN ('COMMAND','QUICK_SALE'));

ALTER TABLE commands ALTER COLUMN table_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS commands_sale_channel_idx ON commands(sale_channel,opened_at DESC);

CREATE OR REPLACE VIEW command_locations AS
SELECT c.id AS command_id,
  CASE
    WHEN c.sale_channel='QUICK_SALE' THEN 'Venda rápida'
    ELSE COALESCE(
      STRING_AGG(COALESCE(bt.label,'Mesa '||bt.number), ' + ' ORDER BY bt.number)
        FILTER (WHERE bt.id IS NOT NULL),
      'Sem mesa'
    )
  END AS display_label
FROM commands c
LEFT JOIN command_tables ct ON ct.command_id=c.id
LEFT JOIN bar_tables bt ON bt.id=ct.table_id
GROUP BY c.id,c.sale_channel;
