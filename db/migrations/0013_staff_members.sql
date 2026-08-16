CREATE TABLE IF NOT EXISTS staff_members (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT UNIQUE,
  contact TEXT,
  position TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$')
);
CREATE INDEX IF NOT EXISTS staff_members_name_idx ON staff_members(LOWER(name));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_member_id BIGINT REFERENCES staff_members(id);
CREATE INDEX IF NOT EXISTS payments_staff_member_idx
  ON payments(staff_member_id) WHERE staff_member_id IS NOT NULL;

INSERT INTO staff_members (name,active)
SELECT DISTINCT ON (LOWER(BTRIM(p.staff_member_name))) BTRIM(p.staff_member_name),TRUE
FROM payments p
WHERE p.method='STAFF_VOUCHER'
  AND p.staff_member_id IS NULL
  AND NULLIF(BTRIM(p.staff_member_name),'') IS NOT NULL
  AND BTRIM(p.staff_member_name) <> 'Funcionário não informado'
  AND NOT EXISTS (
    SELECT 1 FROM staff_members sm
    WHERE LOWER(sm.name)=LOWER(BTRIM(p.staff_member_name))
  )
ORDER BY LOWER(BTRIM(p.staff_member_name)),p.id;

UPDATE payments p
SET staff_member_id=sm.id
FROM staff_members sm
WHERE p.method='STAFF_VOUCHER'
  AND p.staff_member_id IS NULL
  AND LOWER(sm.name)=LOWER(BTRIM(p.staff_member_name));
