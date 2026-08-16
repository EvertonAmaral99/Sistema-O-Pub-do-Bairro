import Link from "next/link";
import { cancelSaleAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateInput, formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { requireRole } from "@/lib/auth";
import { commandLabel } from "@/lib/command-label";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ erro?:string; inicio?:string; fim?:string }> }) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const params=await searchParams; const today=formatDateInput(); const start=params.inicio||today; const end=params.fim||today;
  const currentCashMode=!params.inicio&&!params.fim;
  const currentCashFilter="s.cash_session_id=(SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1)";
  const periodFilter="s.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND s.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')";
  const salesFilter=currentCashMode?currentCashFilter:periodFilter;
  const reportValues=currentCashMode?[]:[start,end];
  const [summary,sales,products,currentCash]=await Promise.all([
    query<{ count:string; total:string; average:string }>(`SELECT COUNT(*)::text AS count,COALESCE(SUM(s.total_cents),0)::text AS total,COALESCE(AVG(s.total_cents),0)::text AS average FROM sales s WHERE s.status='COMPLETED' AND ${salesFilter}`,reportValues),
    query<{ id:number; command_number:number|null; command_name:string|null; table_display:string; total_cents:number; status:string; user_name:string; created_at:string }>(`SELECT s.id,c.command_number,c.command_name,cl.display_label AS table_display,s.total_cents,s.status,u.name AS user_name,s.created_at FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id JOIN users u ON u.id=s.created_by WHERE ${salesFilter} ORDER BY s.created_at DESC`,reportValues),
    query<{ product_name:string; quantity:string; total:string;display_unit:string }>(`SELECT oi.product_name,SUM(oi.quantity)::text AS quantity,SUM(oi.quantity*oi.unit_price_cents)::text AS total,oi.display_unit FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN sales s ON s.command_id=c.id WHERE s.status='COMPLETED' AND ${salesFilter} AND oi.status<>'CANCELLED' GROUP BY oi.product_name,oi.display_unit ORDER BY SUM(oi.quantity) DESC LIMIT 10`,reportValues),
    query<{id:number;opened_at:string}>("SELECT id,opened_at FROM cash_sessions WHERE status='OPEN' LIMIT 1"),
  ]); const data=summary.rows[0];
  const openCash=currentCash.rows[0];
  const revenueMeta=currentCashMode?(openCash?`caixa #${openCash.id} · aberto em ${formatDateTime(openCash.opened_at)}`:"nenhum caixa aberto"):"vendas concluídas no período";
  return <><div className="page-head"><div><p className="eyebrow">Desempenho</p><h2>Relatórios de vendas</h2><p>O resumo inicial acompanha o caixa aberto. Use as datas para consultar o histórico.</p></div>{currentCashMode&&openCash&&<span className="badge badge-green">Caixa #{openCash.id} em andamento</span>}</div>{params.erro&&<div className="alert alert-error">{params.erro}</div>}
    <form method="get" className="card actions" style={{marginBottom:22}}><div className="field"><label>Data inicial</label><input className="input" name="inicio" type="date" defaultValue={start}/></div><div className="field"><label>Data final</label><input className="input" name="fim" type="date" defaultValue={end}/></div><button className="btn btn-primary" type="submit">Consultar período</button>{!currentCashMode&&<Link className="btn btn-light" href="/relatorios">Voltar ao caixa atual</Link>}</form>
    <section className="grid grid-3"><div className="card stat"><span className="stat-label">Faturamento</span><strong className="stat-value">{formatMoney(data.total)}</strong><span className="stat-meta">{revenueMeta}</span></div><div className="card stat"><span className="stat-label">Quantidade de vendas</span><strong className="stat-value">{data.count}</strong><span className="stat-meta">{currentCashMode?"no caixa atual":"no período"}</span></div><div className="card stat"><span className="stat-label">Média por venda</span><strong className="stat-value">{formatMoney(data.average)}</strong><span className="stat-meta">valor médio</span></div></section>
    <div className="grid grid-2" style={{marginTop:22}}><section><h3>Vendas</h3><div className="table-wrap"><table><thead><tr><th>Venda</th><th>Comanda/Mesa</th><th>Data</th><th>Total</th><th>Situação</th>{["ADMIN","MANAGER"].includes(user.role)&&<th>Ação</th>}</tr></thead><tbody>{sales.rows.map(s=><tr key={s.id}><td>#{s.id}<br/><small>{s.user_name}</small></td><td>{commandLabel(s)} · {s.table_display}</td><td>{formatDateTime(s.created_at)}</td><td className="money">{formatMoney(s.total_cents)}</td><td><span className={`badge ${s.status==="COMPLETED"?"badge-green":"badge-red"}`}>{s.status==="COMPLETED"?"Concluída":"Cancelada"}</span></td>{["ADMIN","MANAGER"].includes(user.role)&&<td>{s.status==="COMPLETED"&&<form action={cancelSaleAction} className="actions"><input type="hidden" name="saleId" value={s.id}/><input className="input" name="reason" placeholder="Motivo" required style={{width:130,minHeight:34}}/><button className="btn btn-danger btn-small" type="submit">Cancelar</button></form>}</td>}</tr>)}</tbody></table></div></section>
      <section><h3>Produtos mais vendidos</h3><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>{products.rows.map(p=><tr key={`${p.product_name}-${p.display_unit}`}><td><strong>{p.product_name}</strong></td><td>{formatQuantity(p.quantity,p.display_unit)}</td><td className="money">{formatMoney(p.total)}</td></tr>)}</tbody></table></div></section></div>
  </>;
}
