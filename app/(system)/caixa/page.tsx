import { openCashAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireRole } from "@/lib/auth";
import { CashClosingForm } from "@/components/cash-closing-form";
import { commandLabel } from "@/lib/command-label";

export default async function CashPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requireRole(["ADMIN","MANAGER"]);
  const { erro } = await searchParams;
  const current = await query<{ id:number; opening_amount_cents:number; opened_at:string; opened_by_name:string }>(`SELECT cs.id,cs.opening_amount_cents,cs.opened_at,u.name AS opened_by_name FROM cash_sessions cs JOIN users u ON u.id=cs.opened_by WHERE cs.status='OPEN' LIMIT 1`);
  const cash = current.rows[0];
  const totals = cash ? await query<{ method:string; total:string }>(`SELECT p.method,COALESCE(SUM(p.amount_cents),0)::text AS total FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$1 AND s.status='COMPLETED' GROUP BY p.method`,[cash.id]) : {rows:[]};
  const salesSummary = cash ? await query<{ total:string }>(`SELECT COALESCE(SUM(total_cents),0)::text AS total FROM sales WHERE cash_session_id=$1 AND status='COMPLETED'`,[cash.id]) : {rows:[{total:"0"}]};
  const sales = cash ? await query<{ id:number; command_number:number|null; command_name:string|null; total_cents:number; created_at:string }>(`SELECT s.id,c.command_number,c.command_name,s.total_cents,s.created_at FROM sales s JOIN commands c ON c.id=s.command_id WHERE s.cash_session_id=$1 AND s.status='COMPLETED' ORDER BY s.created_at DESC LIMIT 20`,[cash.id]) : {rows:[]};
  const map=Object.fromEntries(totals.rows.map(t=>[t.method,Number(t.total)]));
  const salesTotal=Number(salesSummary.rows[0]?.total??0);
  const paymentsTotal=Object.values(map).reduce((a,b)=>a+b,0);
  return <><div className="page-head"><div><p className="eyebrow">Financeiro</p><h2>Caixa diário</h2><p>Abra o caixa antes de finalizar a primeira venda.</p></div>{cash&&<span className="badge badge-green">Caixa aberto</span>}</div>{erro&&<div className="alert alert-error">{erro}</div>}
    {!cash?<section className="card" style={{maxWidth:560}}><h3>Abrir caixa</h3><form action={openCashAction} className="form-stack"><div className="field"><label>Fundo de caixa em espécie (R$)</label><input className="input" name="openingAmount" type="number" min="0" step="0.01" defaultValue="0" required/><small>Esse valor é apenas o dinheiro inicial da gaveta e não será contado como venda.</small></div><button className="btn btn-primary" type="submit">Abrir caixa do dia</button></form></section>:<>
      <section className="cash-summary-grid"><div className="card stat cash-opening-stat"><span className="stat-label">Fundo de caixa</span><strong className="stat-value">{formatMoney(cash.opening_amount_cents)}</strong><span className="stat-meta">não faz parte das vendas · {cash.opened_by_name} · {formatDateTime(cash.opened_at)}</span></div><div className="card stat"><span className="stat-label">Total vendido</span><strong className="stat-value">{formatMoney(salesTotal)}</strong><span className="stat-meta">somente vendas finalizadas</span></div><div className="card stat"><span className="stat-label">Dinheiro das vendas</span><strong className="stat-value">{formatMoney(map.CASH||0)}</strong><span className="stat-meta">sem o fundo de caixa</span></div><div className="card stat"><span className="stat-label">PIX</span><strong className="stat-value">{formatMoney(map.PIX||0)}</strong><span className="stat-meta">vendas recebidas por PIX</span></div><div className="card stat"><span className="stat-label">Cartão de débito</span><strong className="stat-value">{formatMoney(map.DEBIT||0)}</strong><span className="stat-meta">vendas recebidas no débito</span></div><div className="card stat"><span className="stat-label">Cartão de crédito</span><strong className="stat-value">{formatMoney(map.CREDIT||0)}</strong><span className="stat-meta">vendas recebidas no crédito</span></div><div className="card stat"><span className="stat-label">Vale funcionário</span><strong className="stat-value">{formatMoney(map.STAFF_VOUCHER||0)}</strong><span className="stat-meta">vendas registradas em vale</span></div></section>
      <div className="grid grid-2" style={{marginTop:22}}><section className="card"><h3>Vendas recentes</h3>{sales.rows.length===0?<div className="empty">Nenhuma venda neste caixa.</div>:<div className="table-wrap"><table><thead><tr><th>Venda</th><th>Comanda</th><th>Horário</th><th>Total</th></tr></thead><tbody>{sales.rows.map(s=><tr key={s.id}><td>#{s.id}</td><td>{commandLabel(s)}</td><td>{formatDateTime(s.created_at)}</td><td className="money">{formatMoney(s.total_cents)}</td></tr>)}</tbody></table></div>}</section>
      <CashClosingForm cashId={cash.id} openingAmount={cash.opening_amount_cents} salesTotal={salesTotal} paymentsTotal={paymentsTotal} payments={{cash:map.CASH||0,pix:map.PIX||0,debit:map.DEBIT||0,credit:map.CREDIT||0,staffVoucher:map.STAFF_VOUCHER||0}}/></div>
    </>}
  </>;
}
