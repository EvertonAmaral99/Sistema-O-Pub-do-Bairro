import Link from "next/link";
import { Plus, Radio } from "lucide-react";
import { openCommandAction } from "@/app/system-actions";
import { LiveRefresh } from "@/components/live-refresh";
import { PriorityInfo } from "@/components/priority-info";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { commandLabel } from "@/lib/command-label";

export default async function CommandsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("COMMANDS");
  const { erro } = await searchParams;
  const [tables, commands] = await Promise.all([
    query<{ id: number; number: number; label: string }>(`SELECT bt.id,bt.number,COALESCE(bt.label,'Mesa '||bt.number) AS label FROM bar_tables bt WHERE bt.active=TRUE ORDER BY bt.number`),
    query<{ id: number; command_number: number|null; command_name:string|null; table_display: string; customer_name: string | null; opened_at: string; items: string; total: string; priority:boolean;priority_note:string|null }>(`SELECT c.id,c.command_number,c.command_name,cl.display_label AS table_display,c.customer_name,c.opened_at,c.priority,c.priority_note,
      COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS items,
      COALESCE(SUM(oi.unit_price_cents*oi.quantity) FILTER (WHERE oi.status<>'CANCELLED'),0)::text AS total
      FROM commands c JOIN command_locations cl ON cl.command_id=c.id LEFT JOIN order_items oi ON oi.command_id=c.id
      WHERE c.status='OPEN' GROUP BY c.id,cl.display_label ORDER BY c.priority DESC,c.opened_at`),
  ]);
  return (
    <div className="commands-page">
      <LiveRefresh/>
      <div className="page-head commands-page-head"><div><p className="eyebrow">Atendimento</p><h2>Mesas e comandas</h2><p>Escolha uma ou várias mesas para cada comanda.</p></div><span className="badge badge-blue"><Radio size={13}/> Atualização automática</span></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <section className="card command-opening-card">
        <h3><Plus size={17}/> Abrir nova comanda</h3>
        <form action={openCommandAction} className="form-grid command-opening-form">
          <div className="field command-number-field"><label>Número da comanda (opcional)</label><input className="input" name="commandNumber" type="number" inputMode="numeric" min="1" autoComplete="off" autoFocus /><small>Informe o número ou use um nome ao lado.</small></div>
          <div className="field command-name-field"><label>Nome da comanda (opcional)</label><input className="input" name="commandName" maxLength={80} autoComplete="off" placeholder="Ex.: Aniversário da Maria"/><small>O sistema exige número, nome ou ambos.</small></div>
          <div className="field command-client-field"><label>Nome do cliente (opcional)</label><input className="input" name="customerName" autoComplete="off" /></div>
          <div className="field command-notes-field"><label>Observação (opcional)</label><input className="input" name="notes" autoComplete="off" /></div>
          <div className="field span-2 command-table-field"><label>Mesas desta comanda</label><div className="table-choice-grid command-table-choice-grid">{tables.rows.map((table)=><label className="table-choice" key={table.id}><input type="checkbox" name="tableIds" value={table.id}/><span><strong>{table.label}</strong><small>Mesa {table.number}</small></span></label>)}</div><small>Marque uma mesa ou várias mesas. A mesma mesa pode estar em outras comandas abertas.</small></div>
          <div className="form-submit-field command-open-submit"><button className="btn btn-primary" type="submit">Abrir comanda</button></div>
        </form>
      </section>
      {commands.rows.length === 0 ? <div className="card empty">Nenhuma comanda aberta.</div> : <div className="command-grid">
        {commands.rows.map((command) => { const itemCount=Math.trunc(Number(command.items)); return <Link className={`command-card ${command.priority ? "priority-alert" : ""}`} href={`/comandas/${command.id}`} key={command.id}>
          <div className="command-top"><span className="command-number">{commandLabel(command)}</span><span className="badge badge-amber">{command.table_display}</span></div>
          {command.priority && <div className="priority-label">Prioridade <PriorityInfo note={command.priority_note}/></div>}
          <p>{command.customer_name || "Cliente não informado"}<br/>{itemCount.toLocaleString("pt-BR")} {itemCount===1?"item":"itens"} · {formatDateTime(command.opened_at)}</p>
          <strong className="money">{formatMoney(command.total)}</strong>
        </Link>;})}
      </div>}
    </div>
  );
}
