import { query } from "@/lib/db";

export type CurrentCashRevenue = {
  cashOpen: boolean;
  cashSessionId: number | null;
  openedAt: string | null;
  revenueCents: number;
  salesCount: number;
  pendingCents: number;
  pendingCount: number;
  totalCents: number;
};

export async function getCurrentCashRevenue(): Promise<CurrentCashRevenue> {
  const result = await query<{
    cash_session_id: number | null;
    opened_at: string | Date | null;
    revenue: string;
    sales_count: string;
    pending: string;
    pending_count: string;
  }>(`
    WITH current_cash AS (
      SELECT id, opened_at
      FROM cash_sessions
      WHERE status='OPEN'
      ORDER BY opened_at DESC
      LIMIT 1
    )
    SELECT
      (SELECT id FROM current_cash) AS cash_session_id,
      (SELECT opened_at FROM current_cash) AS opened_at,
      COALESCE((
        SELECT SUM(s.total_cents)
        FROM sales s
        WHERE s.status='COMPLETED'
          AND s.cash_session_id=(SELECT id FROM current_cash)
      ),0)::text AS revenue,
      COALESCE((
        SELECT COUNT(*)
        FROM sales s
        WHERE s.status='COMPLETED'
          AND s.cash_session_id=(SELECT id FROM current_cash)
      ),0)::text AS sales_count,
      COALESCE((
        SELECT SUM(oi.unit_price_cents*oi.quantity)
        FROM order_items oi
        JOIN commands c ON c.id=oi.command_id
        WHERE c.status='OPEN'
          AND oi.status<>'CANCELLED'
      ),0)::text AS pending,
      COALESCE((
        SELECT COUNT(*)
        FROM commands c
        WHERE c.status='OPEN'
      ),0)::text AS pending_count
  `);

  const row = result.rows[0];
  const revenueCents = Number(row?.revenue ?? 0);
  const pendingCents = Number(row?.pending ?? 0);
  const cashSessionId = row?.cash_session_id ?? null;

  return {
    cashOpen: cashSessionId !== null,
    cashSessionId,
    openedAt: row?.opened_at ? new Date(row.opened_at).toISOString() : null,
    revenueCents,
    salesCount: Number(row?.sales_count ?? 0),
    pendingCents,
    pendingCount: Number(row?.pending_count ?? 0),
    totalCents: revenueCents + pendingCents,
  };
}
