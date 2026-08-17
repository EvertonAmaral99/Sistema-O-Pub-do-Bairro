INSERT INTO staff_members (name,active,created_by)
SELECT BTRIM(u.name),TRUE,u.id
FROM users u
WHERE u.active=TRUE
  AND NULLIF(BTRIM(u.name),'') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM staff_members sm
    WHERE LOWER(BTRIM(sm.name))=LOWER(BTRIM(u.name))
  );
