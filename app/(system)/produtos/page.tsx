import Image from "next/image";
import Link from "next/link";
import { ImageIcon, Pencil, Trash2 } from "lucide-react";
import { createProductAction, deleteProductAction } from "@/app/system-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ProductStockFields, type DraftStockPool } from "@/components/product-stock-fields";
import { query } from "@/lib/db";
import { formatMoney, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { isManagementRole } from "@/lib/roles";

type ProductRow = {
  id: number;
  name: string;
  category: string;
  price_cents: number;
  stock_quantity: number | string;
  min_stock: number | string;
  destination: string;
  sale_unit: string;
  stock_per_sale_unit: number | string;
  stock_pool_id: number;
  stock_kind: string | null;
  stock_unlimited: boolean;
  stock_pool_products: number|string;
  active: boolean;
  has_image: boolean;
  image_updated_at: string | null;
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await requirePermission("PRODUCTS");
  const { erro } = await searchParams;
  const [products,draftPoolsResult] = await Promise.all([
    query<ProductRow>(`SELECT p.id,p.name,p.category,p.price_cents,sp.stock_quantity,sp.min_stock,p.destination,p.sale_unit,p.stock_per_sale_unit,p.stock_pool_id,sp.stock_kind,sp.unlimited AS stock_unlimited,p.active,
      (SELECT COUNT(*) FROM products linked WHERE linked.stock_pool_id=p.stock_pool_id AND linked.deleted_at IS NULL)::text AS stock_pool_products,
      (p.image_data IS NOT NULL) AS has_image,p.image_updated_at FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.deleted_at IS NULL ORDER BY p.active DESC,p.category,p.name`),
    query<{stock_kind:"DRAFT_BEER"|"DRAFT_WINE";stock_quantity:number|string}>(`SELECT stock_kind,stock_quantity FROM stock_pools WHERE stock_kind IN ('DRAFT_BEER','DRAFT_WINE') ORDER BY stock_kind`),
  ]);
  const draftPools:DraftStockPool[]=draftPoolsResult.rows.map((pool)=>({stockKind:pool.stock_kind,stockQuantity:pool.stock_quantity}));
  const area: Record<string,string> = { KITCHEN:"Cozinha",BAR:"Bar",DIRECT:"Entrega direta" };

  return <>
    <div className="page-head"><div><p className="eyebrow">Cardápio</p><h2>Produtos e preços</h2><p>Cadastre os itens vendidos, suas fotos, estoque e setor de preparo.</p></div></div>
    {erro && <div className="alert alert-error">{erro}</div>}
    <section className="card" style={{ marginBottom:22 }}>
      <h3>Novo produto</h3>
      <form action={createProductAction} className="form-grid">
        <div className="field"><label>Nome</label><input className="input uppercase-input" name="name" required/><small>O nome será salvo automaticamente em caixa alta.</small></div>
        <div className="field"><label>Categoria</label><select className="select" name="category" required><option value="Bebidas">Bebidas</option><option value="Chopes e cervejas">Chopes e cervejas</option><option value="Drinks">Drinks</option><option value="Porções">Porções</option><option value="Lanches">Lanches</option><option value="Sobremesas">Sobremesas</option><option value="Outros">Outros</option></select></div>
        <div className="field"><label>Preço (R$)</label><input className="input" name="price" type="number" min="0" step="0.01" required/></div>
        <div className="field"><label>Setor</label><select className="select" name="destination"><option value="DIRECT">Entrega direta pelo garçom</option><option value="BAR">Bar — entrega pelo garçom</option><option value="KITCHEN">Cozinha — requer preparo</option></select><small>Somente produtos do setor Cozinha serão enviados para a tela de preparo.</small></div>
        <ProductStockFields draftPools={draftPools}/>
        <div className="field"><label>Foto do produto</label><input className="input file-input" name="image" type="file" accept="image/jpeg,image/png,image/webp"/><small>JPG, PNG ou WebP, até 3 MB.</small></div>
        <div className="form-submit-field"><button className="btn btn-primary" type="submit">Cadastrar produto</button></div>
      </form>
    </section>
    <div className="table-wrap"><table><thead><tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Setor</th><th>Estoque</th><th>Mínimo</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{products.rows.map((product)=><tr key={product.id}>
      <td>{product.has_image ? <Image className="product-thumb" src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at ?? "1")}`} alt={product.name} width={52} height={52} unoptimized/> : <span className="product-thumb product-thumb-empty"><ImageIcon size={19}/></span>}</td>
      <td><strong>{product.name}</strong>{product.stock_kind&&<><br/><span className="badge badge-blue stock-shared-badge">{product.stock_kind==="DRAFT_BEER"?"Estoque: chopp cerveja":"Estoque: chopp vinho"}</span></>}{!product.stock_kind&&Number(product.stock_pool_products)>1&&<><br/><span className="badge badge-blue stock-shared-badge">Estoque compartilhado antigo</span></>}</td><td>{product.category}</td><td className="money">{formatMoney(product.price_cents)}</td><td>{area[product.destination]}</td><td className="number">{product.stock_unlimited?<span className="badge badge-blue">Ilimitado</span>:formatQuantity(product.stock_quantity,product.sale_unit)}</td><td className="number">{product.stock_unlimited?"—":formatQuantity(product.min_stock,product.sale_unit)}</td><td><span className={`badge ${!product.active?"badge-gray":!product.stock_unlimited&&Number(product.stock_quantity)<=Number(product.min_stock)?"badge-red":"badge-green"}`}>{!product.active?"Inativo":!product.stock_unlimited&&Number(product.stock_quantity)<=Number(product.min_stock)?"Estoque baixo":"Ativo"}</span></td><td><div className="actions"><Link href={`/produtos/${product.id}`} className="btn btn-light btn-small" title={`Editar ${product.name}`}><Pencil size={15}/> Editar</Link>{isManagementRole(user.role)&&<form action={deleteProductAction}><input type="hidden" name="productId" value={product.id}/><ConfirmSubmitButton className="btn btn-danger btn-small" message={`Excluir o cadastro de ${product.name}? O histórico de vendas será preservado.`}><Trash2 size={15}/> Excluir</ConfirmSubmitButton></form>}</div></td>
    </tr>)}</tbody></table></div>
  </>;
}
