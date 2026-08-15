import { BrandLogo } from "@/components/brand-logo";
import { PrintActions } from "@/components/print-actions";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatQuantity } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ShoppingListPrintPage() {
  await requirePermission("STOCK");
  const products = await query<{ id:number;name:string;category:string;stock_quantity:number|string;min_stock:number|string;sale_unit:string }>("SELECT id,name,category,stock_quantity,min_stock,sale_unit FROM products WHERE active=TRUE AND stock_quantity<=min_stock ORDER BY category,name");
  return <main className="print-page"><PrintActions/><header className="print-title"><BrandLogo className="print-logo"/><h1>O Pub do Bairro</h1><strong>LISTA DE COMPRAS PARA REPOSIÇÃO</strong><p>Gerada em {formatDateTime(new Date())}</p></header><div className="divider"/>
    {products.rows.length===0?<p style={{textAlign:"center"}}>Nenhum produto está no estoque mínimo.</p>:<table><thead><tr><th>Produto</th><th>Categoria</th><th>Saldo atual</th><th>Estoque mínimo</th><th>Comprar</th></tr></thead><tbody>{products.rows.map((product)=><tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.category}</td><td>{formatQuantity(product.stock_quantity,product.sale_unit)}</td><td>{formatQuantity(product.min_stock,product.sale_unit)}</td><td style={{minWidth:180}}>________________</td></tr>)}</tbody></table>}
    <div className="divider"/><p style={{textAlign:"center"}}>Produtos incluídos automaticamente ao atingir o estoque mínimo.</p>
  </main>;
}
