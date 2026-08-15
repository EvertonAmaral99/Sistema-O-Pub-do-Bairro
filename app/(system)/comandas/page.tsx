import Link from "next/link";
import { Plus } from "lucide-react";
import { openCommandAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export default async function CommandsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("COMMANDS");
  const { erro } = await searchParams;
  const [tables, commands] = await Promise.all([
    query<{ id: number; number: number; label: string }>("SELECT id,number,COALESCE(label,'Mesa '||number) AS label FROM bar_tables WHERE active=TRUE ORDER BY number"),
    query<{ id: number; command_number: number; table_number: number; customer_name: string | null; opened_at: string; items: string; total: string }>(`SELECT c.id,c.command_number,t.number AS table_number,c.customer_name,c.opened_at,
      COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS items,
      COALESCE(SUM(oi.unit_price_cents*oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS total
      FROM commands c JOIN bar_tables t ON t.id=c.table_id LEFT JOIN order_items oi ON oi.command_id=c.id
      WHERE c.status='OPEN' GROUP BY c.id,t.number ORDER BY c.opened_at`),
  ]);
  return (
    <>
      <div className="page-head"><div><p className="eyebrow">Atendimento</p><h2>Mesas e comandas</h2><p>Cada comanda fica vinculada à mesa escolhida pelo cliente.</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="card" style={{ marginBottom: 22 }}>
        <h3><Plus size={17}/> Abrir nova comanda</h3>
        <form action={openCommandAction} className="form-grid">
          <div className="field"><label>Número da comanda</label><input className="input" name="commandNumber" type="number" min="1" required autoFocus /></div>
          <div className="field"><label>Mesa</label><select className="select" name="tableId" required><option value="">Selecione</option>{tables.rows.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</select></div>
          <div className="field"><label>Nome do cliente (opcional)</label><input className="input" name="customerName" /></div>
          <div className="field"><label>Observação (opcional)</label><input className="input" name="notes" /></div>
          <div><button className="btn btn-primary" type="submit">Abrir comanda</button></div>
        </form>
      </section>
      {commands.rows.length === 0 ? <div className="card empty">Nenhuma comanda aberta.</div> : <div className="command-grid">
        {commands.rows.map((command) => <Link className="command-card" href={`/comandas/${command.id}`} key={command.id}>
          <div className="command-top"><span className="command-number">#{command.command_number}</span><span className="badge badge-amber">Mesa {command.table_number}</span></div>
          <p>{command.customer_name || "Cliente não informado"}<br/>{command.items} item(ns) · {formatDateTime(command.opened_at)}</p>
          <strong className="money">{formatMoney(command.total)}</strong>
        </Link>)}
      </div>}
    </>
  );
}
