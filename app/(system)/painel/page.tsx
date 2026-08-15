import Link from "next/link";
import { AlertTriangle, ChefHat, ClipboardList, WalletCards } from "lucide-react";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { hasPermission, isManagementRole } from "@/lib/roles";
import { PriorityInfo } from "@/components/priority-info";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await requirePermission("DASHBOARD");
  const canUseCommands = hasPermission(user, "COMMANDS");
  const canViewFinance = isManagementRole(user.role);
  const { erro } = await searchParams;
  const [stats, commands] = await Promise.all([
    query<{ open_commands: string; today_sales: string; low_stock: string; prep_items: string }>(`SELECT
      (SELECT COUNT(*) FROM commands WHERE status='OPEN')::text AS open_commands,
      (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE status='COMPLETED' AND created_at >= date_trunc('day',NOW()))::text AS today_sales,
      (SELECT COUNT(*) FROM products WHERE active=TRUE AND stock_quantity<=min_stock)::text AS low_stock,
      (SELECT COUNT(*) FROM order_items WHERE status IN ('SENT','PREPARING','READY'))::text AS prep_items`),
    query<{ id: number; command_number: number; table_display: string; customer_name: string | null; opened_at: string; total: string;priority:boolean;priority_note:string|null }>(`SELECT c.id,c.command_number,tl.display_label AS table_display,c.customer_name,c.opened_at,c.priority,c.priority_note,
      COALESCE(SUM(oi.unit_price_cents*oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS total
      FROM commands c JOIN table_locations tl ON tl.table_id=c.table_id LEFT JOIN order_items oi ON oi.command_id=c.id
      WHERE c.status='OPEN' GROUP BY c.id,tl.display_label ORDER BY c.priority DESC,c.opened_at DESC LIMIT 8`),
  ]);
  const data = stats.rows[0];
  return (
    <>
      <div className="page-head"><div><p className="eyebrow">Hoje no pub</p><h2>Visão geral</h2><p>Acompanhe os pontos principais da operação.</p></div>{canUseCommands && <Link href="/comandas" className="btn btn-primary">Nova comanda</Link>}</div>
      {erro === "permissao" && <div className="alert alert-error">Seu perfil não possui acesso a essa área.</div>}
      <section className={`grid ${canViewFinance ? "grid-4" : "grid-3"}`}>
        <div className="card stat"><span className="stat-label"><ClipboardList size={16}/> Comandas abertas</span><strong className="stat-value">{data.open_commands}</strong><span className="stat-meta">em atendimento agora</span></div>
        {canViewFinance && <div className="card stat"><span className="stat-label"><WalletCards size={16}/> Vendas de hoje</span><strong className="stat-value">{formatMoney(data.today_sales)}</strong><span className="stat-meta">vendas finalizadas</span></div>}
        <div className="card stat"><span className="stat-label"><ChefHat size={16}/> Em preparo</span><strong className="stat-value">{data.prep_items}</strong><span className="stat-meta">itens na cozinha e no bar</span></div>
        <div className="card stat"><span className="stat-label"><AlertTriangle size={16}/> Estoque baixo</span><strong className="stat-value">{data.low_stock}</strong><span className="stat-meta">produtos no mínimo ou abaixo</span></div>
      </section>
      <section className="card" style={{ marginTop: 22 }}>
        <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Comandas em andamento</h3><p>Últimas comandas abertas.</p></div>{canUseCommands && <Link href="/comandas" className="btn btn-light btn-small">Ver todas</Link>}</div>
        {commands.rows.length === 0 ? <div className="empty">Nenhuma comanda aberta.</div> : <div className="command-grid">
          {commands.rows.map((command) => canUseCommands ? <Link className={`command-card ${command.priority?"priority-alert":""}`} href={`/comandas/${command.id}`} key={command.id}>
            <div className="command-top"><span className="command-number">#{command.command_number}</span><span className="badge badge-amber">{command.table_display}</span></div>
            {command.priority&&<div className="priority-label">Prioridade <PriorityInfo note={command.priority_note}/></div>}
            <p>{command.customer_name || "Cliente não informado"}<br/>{formatDateTime(command.opened_at)}</p>{canViewFinance && <strong className="money">{formatMoney(command.total)}</strong>}
          </Link> : <div className={`command-card ${command.priority?"priority-alert":""}`} key={command.id}>
            <div className="command-top"><span className="command-number">#{command.command_number}</span><span className="badge badge-amber">{command.table_display}</span></div>
            {command.priority&&<div className="priority-label">Prioridade <PriorityInfo note={command.priority_note}/></div>}
            <p>{command.customer_name || "Cliente não informado"}<br/>{formatDateTime(command.opened_at)}</p>{canViewFinance && <strong className="money">{formatMoney(command.total)}</strong>}
          </div>)}
        </div>}
      </section>
    </>
  );
}
