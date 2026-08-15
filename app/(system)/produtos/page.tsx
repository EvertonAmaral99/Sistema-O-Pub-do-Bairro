import { createProductAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("PRODUCTS");
  const { erro } = await searchParams;
  const products = await query<{ id:number; name:string; category:string; price_cents:number; stock_quantity:number; min_stock:number; destination:string; active:boolean }>("SELECT id,name,category,price_cents,stock_quantity,min_stock,destination,active FROM products ORDER BY active DESC,category,name");
  const area: Record<string,string> = { KITCHEN:"Cozinha",BAR:"Bar",DIRECT:"Entrega direta" };
  return <><div className="page-head"><div><p className="eyebrow">Cardápio</p><h2>Produtos e preços</h2><p>Cadastre os itens vendidos e indique o setor de preparo.</p></div></div>{erro && <div className="alert alert-error">{erro}</div>}
    <section className="card" style={{ marginBottom:22 }}><h3>Novo produto</h3><form action={createProductAction} className="form-grid">
      <div className="field"><label>Nome</label><input className="input" name="name" required/></div><div className="field"><label>Categoria</label><input className="input" name="category" placeholder="Cervejas, porções..." required/></div>
      <div className="field"><label>Preço (R$)</label><input className="input" name="price" type="number" min="0" step="0.01" required/></div><div className="field"><label>Setor</label><select className="select" name="destination"><option value="DIRECT">Entrega direta</option><option value="KITCHEN">Cozinha</option><option value="BAR">Bar</option></select></div>
      <div className="field"><label>Estoque inicial</label><input className="input" name="stock" type="number" min="0" defaultValue="0"/></div><div className="field"><label>Estoque mínimo</label><input className="input" name="minStock" type="number" min="0" defaultValue="0"/></div><div><button className="btn btn-primary" type="submit">Cadastrar produto</button></div>
    </form></section>
    <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Setor</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>{products.rows.map((product)=><tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.category}</td><td className="money">{formatMoney(product.price_cents)}</td><td>{area[product.destination]}</td><td className="number">{product.stock_quantity}</td><td><span className={`badge ${!product.active?"badge-gray":product.stock_quantity<=product.min_stock?"badge-red":"badge-green"}`}>{!product.active?"Inativo":product.stock_quantity<=product.min_stock?"Estoque baixo":"Ativo"}</span></td></tr>)}</tbody></table></div>
  </>;
}
