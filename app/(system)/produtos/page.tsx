import Image from "next/image";
import Link from "next/link";
import { ImageIcon, Pencil } from "lucide-react";
import { createProductAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatMoney, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

type ProductRow = {
  id: number;
  name: string;
  category: string;
  price_cents: number;
  stock_quantity: number | string;
  min_stock: number | string;
  destination: string;
  sale_unit: string;
  active: boolean;
  has_image: boolean;
  image_updated_at: string | null;
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await requirePermission("PRODUCTS");
  const { erro } = await searchParams;
  const products = await query<ProductRow>(`SELECT id,name,category,price_cents,stock_quantity,min_stock,destination,sale_unit,active,
    (image_data IS NOT NULL) AS has_image,image_updated_at FROM products ORDER BY active DESC,category,name`);
  const area: Record<string,string> = { KITCHEN:"Cozinha",BAR:"Bar",DIRECT:"Entrega direta" };

  return <>
    <div className="page-head"><div><p className="eyebrow">Cardápio</p><h2>Produtos e preços</h2><p>Cadastre os itens vendidos, suas fotos, estoque e setor de preparo.</p></div></div>
    {erro && <div className="alert alert-error">{erro}</div>}
    <section className="card" style={{ marginBottom:22 }}>
      <h3>Novo produto</h3>
      <form action={createProductAction} className="form-grid">
        <div className="field"><label>Nome</label><input className="input" name="name" required/></div>
        <div className="field"><label>Categoria</label><select className="select" name="category" required><option value="Bebidas">Bebidas</option><option value="Chopes e cervejas">Chopes e cervejas</option><option value="Drinks">Drinks</option><option value="Porções">Porções</option><option value="Lanches">Lanches</option><option value="Sobremesas">Sobremesas</option><option value="Outros">Outros</option></select></div>
        <div className="field"><label>Preço (R$)</label><input className="input" name="price" type="number" min="0" step="0.01" required/></div>
        <div className="field"><label>Setor</label><select className="select" name="destination"><option value="DIRECT">Entrega direta</option><option value="KITCHEN">Cozinha</option><option value="BAR">Bar</option></select></div>
        <div className="field"><label>Forma de controle</label><select className="select" name="saleUnit"><option value="UNIT">Unidade</option><option value="KG">Quilograma (kg)</option><option value="L">Litro (L)</option><option value="PORTION">Porção</option><option value="DOSE">Dose</option><option value="BOTTLE">Garrafa</option><option value="CAN">Lata</option></select></div>
        <div className="field"><label>Estoque inicial</label><input className="input" name="stock" type="number" min="0" step="0.001" defaultValue="0"/></div>
        <div className="field"><label>Estoque mínimo</label><input className="input" name="minStock" type="number" min="0" step="0.001" defaultValue="0"/><small>A lista de compras usará este limite.</small></div>
        <div className="field"><label>Foto do produto</label><input className="input file-input" name="image" type="file" accept="image/jpeg,image/png,image/webp"/><small>JPG, PNG ou WebP, até 3 MB.</small></div>
        <div><button className="btn btn-primary" type="submit">Cadastrar produto</button></div>
      </form>
    </section>
    <div className="table-wrap"><table><thead><tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Setor</th><th>Estoque</th><th>Mínimo</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{products.rows.map((product)=><tr key={product.id}>
      <td>{product.has_image ? <Image className="product-thumb" src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at ?? "1")}`} alt={product.name} width={52} height={52} unoptimized/> : <span className="product-thumb product-thumb-empty"><ImageIcon size={19}/></span>}</td>
      <td><strong>{product.name}</strong></td><td>{product.category}</td><td className="money">{formatMoney(product.price_cents)}</td><td>{area[product.destination]}</td><td className="number">{formatQuantity(product.stock_quantity,product.sale_unit)}</td><td className="number">{formatQuantity(product.min_stock,product.sale_unit)}</td><td><span className={`badge ${!product.active?"badge-gray":Number(product.stock_quantity)<=Number(product.min_stock)?"badge-red":"badge-green"}`}>{!product.active?"Inativo":Number(product.stock_quantity)<=Number(product.min_stock)?"Estoque baixo":"Ativo"}</span></td><td><Link href={`/produtos/${product.id}`} className="btn btn-light btn-small" title={`Editar ${product.name}`}><Pencil size={15}/> Editar</Link></td>
    </tr>)}</tbody></table></div>
  </>;
}
