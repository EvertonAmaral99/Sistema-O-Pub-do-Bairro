ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check CHECK (permission IN (
  'DASHBOARD','COMMANDS','QUICK_SALES','QUICK_SALE_PENDING','DELIVERY','KITCHEN',
  'CUSTOMERS','STAFF','PRODUCTS','STOCK','CASH','FINANCE','PENDING_PAYMENTS',
  'MOVEMENT_MAINTENANCE','REPORTS','AGENDA','AUDIT_LOGS'
));

INSERT INTO user_permissions (user_id,permission)
SELECT u.id,p.permission
FROM users u
CROSS JOIN LATERAL unnest(
  CASE
    WHEN u.role IN ('ADMIN','MANAGER') THEN ARRAY[
      'QUICK_SALES','QUICK_SALE_PENDING','DELIVERY','STAFF','PENDING_PAYMENTS',
      'MOVEMENT_MAINTENANCE','AGENDA','AUDIT_LOGS'
    ]::text[]
    WHEN u.role='CASHIER' THEN ARRAY['QUICK_SALES','QUICK_SALE_PENDING','DELIVERY']::text[]
    ELSE ARRAY[]::text[]
  END
) AS p(permission)
ON CONFLICT DO NOTHING;

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS courier_app_code_not_required BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE delivery_orders
SET courier_app_code=NULL
WHERE courier_app_code IS NOT NULL AND BTRIM(courier_app_code)='';

ALTER TABLE delivery_orders DROP CONSTRAINT IF EXISTS delivery_orders_courier_code_state_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_courier_code_state_check CHECK (
  (courier_app_code IS NULL OR BTRIM(courier_app_code)<>'')
  AND NOT (courier_app_code_not_required AND courier_app_code IS NOT NULL)
);
