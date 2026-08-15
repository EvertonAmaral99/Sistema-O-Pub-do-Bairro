import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ImageIcon, Save } from "lucide-react";
import { notFound } from "next/navigation";
import { updateProductAction } from "@/app/system-actions";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { ProductStockFields, type StockLinkOption } from "@/components/product-stock-fields";

type ProductRow = {
  id:number; name:string; category:string; price_cents:number; stock_quantity:number|string; min_stock:number|string;
  destination:string; sale_unit:string; stock_per_sale_unit:number|string; stock_pool_id:number; stock_unlimited:boolean; shared_with_product_id:number|null; active:boolean; has_image:boolean; image_updated_at:string|null;
};

export default async function EditProductPage({ params, searchParams }: { params:Promise<{id:string}>; searchParams:Promise<{erro?:string}> }) {
  await requirePermission("PRODUCTS");
  const productId = Number((await params).id);
  const { erro } = await searchParams;
  if (!Number.isInteger(productId) || productId < 1) notFound();
  const [result,stockOptionsResult] = await Promise.all([
    query<ProductRow>(`SELECT p.id,p.name,p.category,p.price_cents,sp.stock_quantity,sp.min_stock,p.destination,p.sale_unit,p.stock_per_sale_unit,p.stock_pool_id,sp.unlimited AS stock_unlimited,p.active,
      (SELECT MIN(linked.id) FROM products linked WHERE linked.stock_pool_id=p.stock_pool_id AND linked.id<>p.id) AS shared_with_product_id,
      (p.image_data IS NOT NULL) AS has_image,p.image_updated_at FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1`,[productId]),
    query<{id:number;name:string;stock_pool_id:number;sale_unit:string;stock_quantity:number|string;min_stock:number|string;unlimited:boolean}>(`SELECT p.id,p.name,p.stock_pool_id,sp.sale_unit,sp.stock_quantity,sp.min_stock,sp.unlimited FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id<>$1 ORDER BY p.active DESC,p.name`,[productId]),
  ]);
  const product = result.rows[0];
  if (!product) notFound();
  const stockOptions:StockLinkOption[]=stockOptionsResult.rows.map((option)=>({id:option.id,name:option.name,stockPoolId:option.stock_pool_id,saleUnit:option.sale_unit,stockQuantity:option.stock_quantity,minStock:option.min_stock,unlimited:option.unlimited}));

  return <>
    <div className="page-head"><div><p className="eyebrow">Cadastro de produto</p><h2>Editar {product.name}</h2><p>Altere valor, saldo, estoque mínimo, foto e situação do item.</p></div><Link href="/produtos" className="btn btn-light"><ArrowLeft size={16}/> Voltar</Link></div>
    {erro && <div className="alert alert-error">{erro}</div>}
    <section className="card product-edit-card">
      <form action={updateProductAction} className="form-grid">
        <input type="hidden" name="productId" value={product.id}/>
        <div className="field"><label>Nome</label><input className="input uppercase-input" name="name" defaultValue={product.name} required/><small>O nome será salvo automaticamente em caixa alta.</small></div>
        <div className="field"><label>Categoria</label><select className="select" name="category" defaultValue={product.category} required><option value="Bebidas">Bebidas</option><option value="Chopes e cervejas">Chopes e cervejas</option><option value="Drinks">Drinks</option><option value="Porções">Porções</option><option value="Lanches">Lanches</option><option value="Sobremesas">Sobremesas</option><option value="Outros">Outros</option></select></div>
        <div className="field"><label>Preço (R$)</label><input className="input" name="price" type="number" min="0" step="0.01" defaultValue={(Number(product.price_cents)/100).toFixed(2)} required/></div>
        <div className="field"><label>Setor</label><select className="select" name="destination" defaultValue={product.destination}><option value="DIRECT">Entrega direta</option><option value="KITCHEN">Cozinha</option><option value="BAR">Bar</option></select></div>
        <ProductStockFields mode="edit" options={stockOptions} currentPoolId={product.stock_pool_id} initialLinkedProductId={product.shared_with_product_id} initialSaleUnit={product.sale_unit} initialStockPerSaleUnit={product.stock_per_sale_unit} initialStock={product.stock_quantity} initialMinStock={product.min_stock} initialUnlimited={product.stock_unlimited}/>
        <div className="field"><label>Nova foto</label><input className="input file-input" name="image" type="file" accept="image/jpeg,image/png,image/webp"/><small>Deixe sem arquivo para manter a foto atual.</small></div>
        <div className="product-edit-image span-2">
          {product.has_image ? <Image src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at ?? "1")}`} alt={product.name} width={160} height={160} unoptimized/> : <div className="product-image-placeholder"><ImageIcon size={30}/><span>Produto sem foto</span></div>}
          <div className="form-stack"><label className="check-row"><input type="checkbox" name="active" defaultChecked={product.active}/> Produto ativo para venda</label>{product.has_image && <label className="check-row"><input type="checkbox" name="removeImage"/> Remover a foto atual</label>}</div>
        </div>
        <div className="span-2 actions"><button className="btn btn-primary" type="submit"><Save size={16}/> Salvar alterações</button><Link href="/produtos" className="btn btn-light">Cancelar</Link></div>
      </form>
    </section>
  </>;
}
