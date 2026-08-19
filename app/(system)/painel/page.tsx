import Link from "next/link";
import { AlertTriangle, ChefHat, ClipboardList, WalletCards } from "lucide-react";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/roles";
import { DashboardCommandCard } from "@/components/dashboard-command-card";
import { CommandCardIdentifier } from "@/components/command-card-identifier";
import { PriorityInfo } from "@/components/priority-info";
import { DashboardDeliveryCard, MotorcycleIcon } from "@/components/dashboard-delivery-card";
import { LiveRefresh } from "@/components/live-refresh";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await requirePermission("DASHBOARD");
  const canUseCommands = hasPermission(user, "COMMANDS");
  const canOpenDelivery = hasPermission(user, "DELIVERY");
  const canViewFinance = hasPermission(user, "FINANCE");
  const { erro } = await searchParams;
  const [stats, commands, deliveries] = await Promise.all([
    query<{ open_commands: string; active_deliveries: string; predicted_total: string; low_stock: string; prep_items: string }>(`SELECT
      (SELECT COUNT(*) FROM commands WHERE status='OPEN')::text AS open_commands,
      (SELECT COUNT(*) FROM delivery_orders d JOIN sales s ON s.id=d.sale_id WHERE d.status IN ('PREPARING','READY') AND s.status='COMPLETED')::text AS active_deliveries,
      ((SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE status='COMPLETED' AND cash_session_id=(SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1)) +
       (SELECT COALESCE(SUM(oi.unit_price_cents*oi.quantity),0) FROM order_items oi JOIN commands c ON c.id=oi.command_id WHERE c.status='OPEN' AND oi.status<>'CANCELLED'))::text AS predicted_total,
      (SELECT COUNT(*) FROM stock_pools sp WHERE sp.unlimited=FALSE AND sp.stock_quantity<=sp.min_stock AND EXISTS(SELECT 1 FROM products p WHERE p.stock_pool_id=sp.id AND p.active=TRUE AND p.deleted_at IS NULL))::text AS low_stock,
      (SELECT COUNT(*) FROM order_items WHERE destination='KITCHEN' AND status IN ('SENT','PREPARING','READY'))::text AS prep_items`),
    query<{ id: number; command_number: number|null; command_name:string|null; table_display: string; customer_name: string | null; opened_at: string; total: string;priority:boolean;priority_note:string|null }>(`SELECT c.id,c.command_number,c.command_name,cl.display_label AS table_display,c.customer_name,c.opened_at,c.priority,c.priority_note,
      COALESCE(SUM(oi.unit_price_cents*oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS total
      FROM commands c JOIN command_locations cl ON cl.command_id=c.id LEFT JOIN order_items oi ON oi.command_id=c.id
      WHERE c.status='OPEN' GROUP BY c.id,cl.display_label ORDER BY c.priority DESC,c.opened_at DESC`),
    query<{ id:number; sale_id:number; status:"PREPARING"|"READY"; created_at:string; customer_name:string|null; item_count:string; total:string }>(`SELECT d.id,d.sale_id,d.status,d.created_at,
      COALESCE(customer.name,c.customer_name) AS customer_name,
      COUNT(oi.id) FILTER (WHERE oi.status<>'CANCELLED')::text AS item_count,
      s.total_cents::text AS total
      FROM delivery_orders d JOIN sales s ON s.id=d.sale_id JOIN commands c ON c.id=s.command_id
      LEFT JOIN customers customer ON customer.id=s.customer_id LEFT JOIN order_items oi ON oi.command_id=c.id
      WHERE d.status IN ('PREPARING','READY') AND s.status='COMPLETED'
      GROUP BY d.id,d.sale_id,d.status,d.created_at,customer.name,c.customer_name,s.total_cents
      ORDER BY CASE d.status WHEN 'READY' THEN 1 ELSE 2 END,d.created_at DESC`),
  ]);
  const data = stats.rows[0];
  return (
    <>
      <LiveRefresh intervalMs={5000}/>
      <div className="page-head"><div><p className="eyebrow">Hoje no pub</p><h2>Visão geral</h2><p>Acompanhe os pontos principais da operação.</p></div>{canUseCommands && <Link href="/comandas" className="btn btn-primary">Nova comanda</Link>}</div>
      {erro && <div className="alert alert-error">{erro==="permissao"?"Seu perfil não possui acesso a essa área.":erro}</div>}
      <section className="grid dashboard-stats">
        <div className="card stat"><span className="stat-label"><ClipboardList size={16}/> Comandas abertas</span><strong className="stat-value">{data.open_commands}</strong><span className="stat-meta">em atendimento agora</span></div>
        <div className="card stat"><span className="stat-label"><MotorcycleIcon size={17}/> Deliveries ativos</span><strong className="stat-value">{data.active_deliveries}</strong><span className="stat-meta">em preparo ou prontos</span></div>
        {canViewFinance && <div className="card stat"><span className="stat-label"><WalletCards size={16}/> Total previsto</span><strong className="stat-value">{formatMoney(data.predicted_total)}</strong><span className="stat-meta">vendas do caixa aberto + comandas abertas</span></div>}
        <div className="card stat"><span className="stat-label"><ChefHat size={16}/> Em preparo</span><strong className="stat-value">{data.prep_items}</strong><span className="stat-meta">somente itens da cozinha</span></div>
        <div className="card stat"><span className="stat-label"><AlertTriangle size={16}/> Estoque baixo</span><strong className="stat-value">{data.low_stock}</strong><span className="stat-meta">produtos no mínimo ou abaixo</span></div>
      </section>
      <section className="card" style={{ marginTop: 22 }}>
        <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Atendimentos em andamento</h3><p>Todas as comandas abertas e vendas rápidas de delivery ativas.</p></div><div className="actions"><span className="badge badge-amber">{commands.rows.length} comanda(s)</span><span className="badge badge-blue"><MotorcycleIcon size={14}/>{deliveries.rows.length} delivery(s)</span></div></div>
        {commands.rows.length === 0 && deliveries.rows.length === 0 ? <div className="empty">Nenhuma comanda ou delivery em andamento.</div> : <div className="command-grid">
          {commands.rows.map((command) => canUseCommands ? <DashboardCommandCard command={command} canViewFinance={canViewFinance} key={command.id}/> : <div className={`command-card ${command.priority?"priority-alert":""}`} key={command.id}>
            <div className="command-top"><CommandCardIdentifier commandNumber={command.command_number} commandName={command.command_name}/><span className="badge badge-amber">{command.table_display}</span></div>
            {command.priority&&<div className="priority-label">Prioridade <PriorityInfo note={command.priority_note}/></div>}
            <p>{command.customer_name || "Cliente não informado"}<br/>{formatDateTime(command.opened_at)}</p>{canViewFinance && <strong className="money">{formatMoney(command.total)}</strong>}
          </div>)}
          {deliveries.rows.map((delivery)=><DashboardDeliveryCard delivery={delivery} canOpenDelivery={canOpenDelivery} canViewFinance={canViewFinance} key={`delivery-${delivery.id}`}/>)}
        </div>}
      </section>
    </>
  );
}
