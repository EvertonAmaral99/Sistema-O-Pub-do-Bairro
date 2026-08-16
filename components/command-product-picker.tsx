"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ImageIcon, Search, X } from "lucide-react";
import { addItemAction } from "@/app/system-actions";
import { formatMoney } from "@/lib/format";

export type CommandProduct = {
  id:number;
  name:string;
  category:string;
  price_cents:number;
  stock_quantity:number|string;
  stock_unlimited:boolean;
  stock_shared:boolean;
  stock_kind:string|null;
  stock_per_sale_unit:number|string;
  has_image:boolean;
  image_updated_at:string|null;
};

function searchable(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleUpperCase("pt-BR");
}

export function CommandProductPicker({ products, commandId, commandOpen }: { products:CommandProduct[]; commandId:number; commandOpen:boolean }) {
  const [query,setQuery]=useState("");
  const allowedProducts=useMemo(()=>products.filter((product)=>!searchable(product.name).includes("ESTOQUE")),[products]);
  const filteredProducts=useMemo(()=>{
    const terms=searchable(query).trim().split(/\s+/).filter(Boolean);
    if(terms.length===0) return allowedProducts;
    return allowedProducts.filter((product)=>{
      const content=searchable(`${product.name} ${product.category}`);
      return terms.every((term)=>content.includes(term));
    });
  },[allowedProducts,query]);

  return <>
    <div className="live-product-search">
      <Search className="live-search-icon" size={19}/>
      <input className="input" type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Digite o nome ou a categoria do produto" aria-label="Buscar produtos em tempo real" autoComplete="off"/>
      {query&&<button className="live-search-clear" type="button" onClick={()=>setQuery("")} aria-label="Limpar busca"><X size={18}/></button>}
    </div>
    <p className="live-search-result-count" aria-live="polite">{filteredProducts.length} produto(s) encontrado(s)</p>
    {filteredProducts.length===0?<div className="empty product-search-empty">Nenhum produto encontrado.</div>:<div className="product-list">
      {filteredProducts.map((product)=>{
        const availableUnits=product.stock_unlimited?undefined:String(Math.floor(Number(product.stock_quantity)/Number(product.stock_per_sale_unit)));
        return <form action={addItemAction} className="product-button product-add-card" key={product.id}>
          <input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="productId" value={product.id}/>
          {product.has_image?<Image className="command-product-photo" src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at??"1")}`} alt={product.name} width={220} height={120} unoptimized/>:<span className="command-product-photo command-product-photo-empty"><ImageIcon size={24}/></span>}
          <strong>{product.name}</strong><small>{product.category} · {product.stock_unlimited?"Disponível sem limite":`Disponível ${availableUnits} un.`}{product.stock_kind?` · ${product.stock_kind==="DRAFT_BEER"?"CHOPP PILSEN":"CHOPP VINHO"}`:product.stock_shared?" · Estoque compartilhado antigo":""}</small><div className="money" style={{marginTop:10}}>{formatMoney(product.price_cents)}</div>
          <div className="product-quantity-row"><input className="input" aria-label={`Quantidade de ${product.name}`} name="quantity" type="number" min="1" max={availableUnits} step="1" defaultValue="1" required/><button className="btn btn-primary btn-small" type="submit" disabled={!commandOpen||(!product.stock_unlimited&&Number(product.stock_quantity)<Number(product.stock_per_sale_unit))}>Adicionar</button></div>
        </form>;
      })}
    </div>}
  </>;
}
