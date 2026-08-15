ALTER TABLE commands ADD COLUMN IF NOT EXISTS command_name TEXT;
ALTER TABLE commands ALTER COLUMN command_number DROP NOT NULL;

DROP INDEX IF EXISTS commands_open_name_idx;
CREATE UNIQUE INDEX commands_open_name_idx
  ON commands ((LOWER(BTRIM(command_name))))
  WHERE status='OPEN' AND command_name IS NOT NULL;

ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_identifier_check;
ALTER TABLE commands ADD CONSTRAINT commands_identifier_check
  CHECK (command_number IS NOT NULL OR NULLIF(BTRIM(command_name),'') IS NOT NULL);
