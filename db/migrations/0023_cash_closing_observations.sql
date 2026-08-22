ALTER TABLE cash_sessions
  ADD COLUMN IF NOT EXISTS closing_observations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cash_sessions DROP CONSTRAINT IF EXISTS cash_sessions_closing_observations_array_check;
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_closing_observations_array_check
  CHECK (jsonb_typeof(closing_observations) = 'array');
