import { adjustStockAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("STOCK");
  const { erro } = await searchParams;
  const [products,movements] = await Promise.all([
    query<{ id:number; name:string; category:string; stock_quantity:number; min_stock:number }>("SELECT id,name,category,stock_quantity,min_stock FROM products WHERE active=TRUE ORDER BY (stock_quantity<=min_stock) DESC,category,name"),
    query<{ id:number; product_name:string; quantity:number; reason:string; user_name:string; created_at:string }>(`SELECT sm.id,p.name AS product_name,sm.quantity,sm.reason,u.name AS user_name,sm.created_at FROM stock_movements sm JOIN products p ON p.id=sm.product_id JOIN users u ON u.id=sm.user_id ORDER BY sm.created_at DESC LIMIT 30`),
  ]);
  const reasons:Record<string,string>={ITEM_ADDED:"Lançamento em comanda",ITEM_REMOVED:"Item removido",MANUAL_ADJUSTMENT:"Ajuste manual",SALE_CANCELLED:"Venda cancelada"};
  return <><div className="page-head"><div><p className="eyebrow">Inventário</p><h2>Controle de estoque</h2><p>A baixa acontece ao lançar na comanda e retorna quando o item é removido.</p></div></div>{erro&&<div className="alert alert-error">{erro}</div>}
    <section className="card" style={{marginBottom:22}}><h3>Ajuste manual</h3><form action={adjustStockAction} className="form-grid"><div className="field"><label>Produto</label><select className="select" name="productId" required><option value="">Selecione</option>{products.rows.map(p=><option key={p.id} value={p.id}>{p.name} — saldo {p.stock_quantity}</option>)}</select></div><div className="field"><label>Quantidade</label><input className="input" name="quantity" type="number" placeholder="Use negativo para retirar" required/></div><div><button className="btn btn-primary" type="submit">Registrar ajuste</button></div></form></section>
    <div className="grid grid-2"><section><h3>Saldo dos produtos</h3><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Saldo</th><th>Mínimo</th></tr></thead><tbody>{products.rows.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.category}</td><td><span className={`badge ${p.stock_quantity<=p.min_stock?"badge-red":"badge-green"}`}>{p.stock_quantity}</span></td><td>{p.min_stock}</td></tr>)}</tbody></table></div></section>
      <section><h3>Últimas movimentações</h3><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Movimento</th><th>Motivo</th><th>Data</th></tr></thead><tbody>{movements.rows.map(m=><tr key={m.id}><td>{m.product_name}</td><td className="money" style={{color:m.quantity>0?"var(--green)":"var(--red)"}}>{m.quantity>0?"+":""}{m.quantity}</td><td>{reasons[m.reason]||m.reason}<br/><small>{m.user_name}</small></td><td>{formatDateTime(m.created_at)}</td></tr>)}</tbody></table></div></section></div>
  </>;
}
