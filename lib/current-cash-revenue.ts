import { query } from "@/lib/db";

export type CurrentCashRevenue = {
  cashOpen: boolean;
  cashSessionId: number | null;
  openedAt: string | null;
  revenueCents: number;
  salesCount: number;
};

export async function getCurrentCashRevenue(): Promise<CurrentCashRevenue> {
  const result = await query<{ id: number; opened_at: string | Date; revenue: string; sales_count: string }>(`
    SELECT
      cs.id,
      cs.opened_at,
      COALESCE(SUM(s.total_cents) FILTER (WHERE s.status='COMPLETED'), 0)::text AS revenue,
      (COUNT(s.id) FILTER (WHERE s.status='COMPLETED'))::text AS sales_count
    FROM cash_sessions cs
    LEFT JOIN sales s ON s.cash_session_id = cs.id
    WHERE cs.status='OPEN'
    GROUP BY cs.id, cs.opened_at
    ORDER BY cs.opened_at DESC
    LIMIT 1
  `);

  const row = result.rows[0];
  if (!row) {
    return { cashOpen: false, cashSessionId: null, openedAt: null, revenueCents: 0, salesCount: 0 };
  }

  return {
    cashOpen: true,
    cashSessionId: row.id,
    openedAt: new Date(row.opened_at).toISOString(),
    revenueCents: Number(row.revenue ?? 0),
    salesCount: Number(row.sales_count ?? 0),
  };
}
