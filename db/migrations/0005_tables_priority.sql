CREATE TABLE IF NOT EXISTS table_combinations (
  id BIGSERIAL PRIMARY KEY,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS table_combination_members (
  combination_id BIGINT NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id BIGINT NOT NULL UNIQUE REFERENCES bar_tables(id),
  PRIMARY KEY (combination_id, table_id)
);

ALTER TABLE commands ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS priority_note TEXT;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS priority_updated_at TIMESTAMPTZ;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS priority_updated_by BIGINT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS commands_priority_idx ON commands(priority) WHERE priority = TRUE;

UPDATE products SET name = UPPER(BTRIM(name)) WHERE name <> UPPER(BTRIM(name));

CREATE OR REPLACE VIEW table_locations AS
SELECT
  bt.id AS table_id,
  tcm.combination_id,
  COALESCE(grouped.display_label, COALESCE(bt.label, 'Mesa ' || bt.number)) AS display_label
FROM bar_tables bt
LEFT JOIN table_combination_members tcm ON tcm.table_id = bt.id
LEFT JOIN LATERAL (
  SELECT string_agg(COALESCE(member.label, 'Mesa ' || member.number), ' + ' ORDER BY member.number) AS display_label
  FROM table_combination_members members
  JOIN bar_tables member ON member.id = members.table_id
  WHERE members.combination_id = tcm.combination_id
) grouped ON TRUE;
