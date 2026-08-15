import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ImageIcon, Save } from "lucide-react";
import { notFound } from "next/navigation";
import { updateProductAction } from "@/app/system-actions";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";

type ProductRow = {
  id:number; name:string; category:string; price_cents:number; stock_quantity:number|string; min_stock:number|string;
  destination:string; sale_unit:string; stock_per_sale_unit:number|string; active:boolean; has_image:boolean; image_updated_at:string|null;
};

export default async function EditProductPage({ params, searchParams }: { params:Promise<{id:string}>; searchParams:Promise<{erro?:string}> }) {
  await requirePermission("PRODUCTS");
  const productId = Number((await params).id);
  const { erro } = await searchParams;
  if (!Number.isInteger(productId) || productId < 1) notFound();
  const result = await query<ProductRow>(`SELECT id,name,category,price_cents,stock_quantity,min_stock,destination,sale_unit,stock_per_sale_unit,active,
    (image_data IS NOT NULL) AS has_image,image_updated_at FROM products WHERE id=$1`,[productId]);
  const product = result.rows[0];
  if (!product) notFound();

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
        <div className="field"><label>Forma de controle</label><select className="select" name="saleUnit" defaultValue={product.sale_unit}><option value="UNIT">Unidade</option><option value="KG">Quilograma (kg)</option><option value="L">Litro (L)</option><option value="PORTION">Porção</option><option value="DOSE">Dose</option><option value="BOTTLE">Garrafa</option><option value="CAN">Lata</option></select></div>
        <div className="field"><label>Baixa de estoque por item vendido</label><input className="input" name="stockPerSaleUnit" type="number" min="0.001" step="0.001" defaultValue={String(product.stock_per_sale_unit)} required/><small>Ex.: CHOPP 500ML controlado em litros deve usar 0,5.</small></div>
        <div className="field"><label>Quantidade em estoque</label><input className="input" name="stock" type="number" min="0" step="0.001" defaultValue={String(product.stock_quantity)} required/></div>
        <div className="field"><label>Estoque mínimo</label><input className="input" name="minStock" type="number" min="0" step="0.001" defaultValue={String(product.min_stock)} required/><small>Ao atingir este valor, o produto entra na lista de compras.</small></div>
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
