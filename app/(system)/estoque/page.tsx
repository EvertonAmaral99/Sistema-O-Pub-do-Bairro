import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { adjustStockAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("STOCK");
  const { erro } = await searchParams;
  const [products,movements] = await Promise.all([
    query<{ id:number; name:string; category:string; stock_quantity:number|string; min_stock:number|string; sale_unit:string }>("SELECT id,name,category,stock_quantity,min_stock,sale_unit FROM products WHERE active=TRUE ORDER BY (stock_quantity<=min_stock) DESC,category,name"),
    query<{ id:number; product_name:string; quantity:number|string; reason:string; user_name:string; created_at:string; sale_unit:string }>(`SELECT sm.id,p.name AS product_name,sm.quantity,sm.reason,u.name AS user_name,sm.created_at,p.sale_unit FROM stock_movements sm JOIN products p ON p.id=sm.product_id JOIN users u ON u.id=sm.user_id ORDER BY sm.created_at DESC LIMIT 30`),
  ]);
  const reasons:Record<string,string>={ITEM_ADDED:"Lançamento em comanda",ITEM_REMOVED:"Item removido",MANUAL_ADJUSTMENT:"Ajuste manual",SALE_CANCELLED:"Venda cancelada",COMMAND_CANCELLED:"Comanda cancelada"};
  const lowStock=products.rows.filter((product)=>Number(product.stock_quantity)<=Number(product.min_stock));
  return <><div className="page-head"><div><p className="eyebrow">Inventário</p><h2>Controle de estoque</h2><p>A baixa acontece ao lançar na comanda e retorna quando o item é removido.</p></div><Link href="/imprimir/lista-compras" target="_blank" className="btn btn-primary"><ShoppingCart size={16}/> Lista de compras ({lowStock.length})</Link></div>{erro&&<div className="alert alert-error">{erro}</div>}
    {lowStock.length>0&&<div className="alert alert-error">{lowStock.length} produto(s) atingiram o estoque mínimo e já estão na lista de compras.</div>}
    <section className="card" style={{marginBottom:22}}><h3>Ajuste manual</h3><form action={adjustStockAction} className="form-grid"><div className="field"><label>Produto</label><select className="select" name="productId" required><option value="">Selecione</option>{products.rows.map(p=><option key={p.id} value={p.id}>{p.name} — saldo {formatQuantity(p.stock_quantity,p.sale_unit)}</option>)}</select></div><div className="field"><label>Quantidade</label><input className="input" name="quantity" type="number" step="0.001" placeholder="Use negativo para retirar" required/></div><div><button className="btn btn-primary" type="submit">Registrar ajuste</button></div></form></section>
    <div className="grid grid-2"><section><h3>Saldo dos produtos</h3><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Saldo</th><th>Mínimo</th></tr></thead><tbody>{products.rows.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.category}</td><td><span className={`badge ${Number(p.stock_quantity)<=Number(p.min_stock)?"badge-red":"badge-green"}`}>{formatQuantity(p.stock_quantity,p.sale_unit)}</span></td><td>{formatQuantity(p.min_stock,p.sale_unit)}</td></tr>)}</tbody></table></div></section>
      <section><h3>Últimas movimentações</h3><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Movimento</th><th>Motivo</th><th>Data</th></tr></thead><tbody>{movements.rows.map(m=><tr key={m.id}><td>{m.product_name}</td><td className="money" style={{color:Number(m.quantity)>0?"var(--green)":"var(--red)"}}>{Number(m.quantity)>0?"+":""}{formatQuantity(m.quantity,m.sale_unit)}</td><td>{reasons[m.reason]||m.reason}<br/><small>{m.user_name}</small></td><td>{formatDateTime(m.created_at)}</td></tr>)}</tbody></table></div></section></div>
  </>;
}
