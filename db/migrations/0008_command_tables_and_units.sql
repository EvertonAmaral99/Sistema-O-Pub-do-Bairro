CREATE TABLE IF NOT EXISTS command_tables (
  command_id BIGINT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  table_id BIGINT NOT NULL REFERENCES bar_tables(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (command_id,table_id)
);
CREATE INDEX IF NOT EXISTS command_tables_table_idx ON command_tables(table_id,command_id);

INSERT INTO command_tables (command_id,table_id)
SELECT c.id,c.table_id FROM commands c
ON CONFLICT DO NOTHING;

INSERT INTO command_tables (command_id,table_id)
SELECT c.id,members.table_id
FROM commands c
JOIN table_combination_members current_member ON current_member.table_id=c.table_id
JOIN table_combination_members members ON members.combination_id=current_member.combination_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW command_locations AS
SELECT c.id AS command_id,
  STRING_AGG(COALESCE(bt.label,'Mesa '||bt.number), ' + ' ORDER BY bt.number) AS display_label
FROM commands c
JOIN command_tables ct ON ct.command_id=c.id
JOIN bar_tables bt ON bt.id=ct.table_id
GROUP BY c.id;

UPDATE order_items SET display_unit='UNIT' WHERE display_unit<>'UNIT';
