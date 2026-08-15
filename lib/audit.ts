import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";

type AuditEntry = {
  userId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  description: string;
  metadata?: Record<string, unknown>;
};

type AuditClient = Pick<PoolClient, "query">;

export async function auditLog(entry: AuditEntry, client?: AuditClient) {
  const executor = client ?? getPool();
  await executor.query(
    `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,description,metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [entry.userId ?? null, entry.action, entry.entityType, entry.entityId == null ? null : String(entry.entityId), entry.description, JSON.stringify(entry.metadata ?? {})],
  );
}
