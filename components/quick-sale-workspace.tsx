"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CloudCheck, CloudOff, ImageIcon, LoaderCircle, Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { saveQuickSaleDraftAction } from "@/app/system-actions";
import { PaymentForm, type CustomerOption, type StaffMemberOption } from "@/components/payment-form";
import type { CommandProduct } from "@/components/command-product-picker";
import { formatMoney } from "@/lib/format";

type CartItem={productId:number;quantity:number};
type QuickSaleDraft={items:unknown;updatedAt:string};
type DraftStatus="restoring"|"saving"|"saved"|"local";

function searchable(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleUpperCase("pt-BR");
}

function availableUnits(product:CommandProduct){
  if(product.stock_unlimited)return Number.MAX_SAFE_INTEGER;
  return Math.max(0,Math.floor(Number(product.stock_quantity)/Number(product.stock_per_sale_unit)));
}

function maxCartQuantity(product:CommandProduct){
  return Math.min(9999,availableUnits(product));
}

function normalizeCart(value:unknown,products:CommandProduct[]):CartItem[]{
  if(!Array.isArray(value))return[];
  const productsById=new Map(products.map((product)=>[product.id,product]));
  const quantities=new Map<number,number>();
  for(const entry of value){
    if(!entry||typeof entry!=="object")continue;
    const source=entry as Record<string,unknown>;
    const productId=Math.trunc(Number(source.productId));
    const quantity=Math.trunc(Number(source.quantity));
    const product=productsById.get(productId);
    if(!product||!Number.isSafeInteger(productId)||!Number.isSafeInteger(quantity)||quantity<1)continue;
    const nextQuantity=Math.min(maxCartQuantity(product),(quantities.get(productId)||0)+quantity);
    if(nextQuantity>0)quantities.set(productId,nextQuantity);
  }
  return[...quantities].map(([productId,quantity])=>({productId,quantity}));
}

export function QuickSaleWorkspace({products,staffMembers,customers,cashOpen,userId,initialDraft}:{products:CommandProduct[];staffMembers:StaffMemberOption[];customers:CustomerOption[];cashOpen:boolean;userId:number;initialDraft:QuickSaleDraft|null}){
  const storageKey=`pub-quick-sale-draft-v1:${userId}`;
  const initialDraftRef=useRef(initialDraft);
  const initialProductsRef=useRef(products);
  const saveQueueRef=useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef=useRef(0);
  const [query,setQuery]=useState("");
  const [cart,setCart]=useState<CartItem[]>(()=>normalizeCart(initialDraft?.items,products));
  const [draftReady,setDraftReady]=useState(false);
  const [draftStatus,setDraftStatus]=useState<DraftStatus>("restoring");
  const [syncAttempt,setSyncAttempt]=useState(0);
  const productsById=useMemo(()=>new Map(products.map((product)=>[product.id,product])),[products]);
  const filteredProducts=useMemo(()=>{
    const terms=searchable(query).trim().split(/\s+/).filter(Boolean);
    if(terms.length===0)return products;
    return products.filter((product)=>{
      const content=searchable(`${product.name} ${product.category}`);
      return terms.every((term)=>content.includes(term));
    });
  },[products,query]);
  const cartDetails=useMemo(()=>cart.map((item)=>({item,product:productsById.get(item.productId)})).filter((entry):entry is {item:CartItem;product:CommandProduct}=>Boolean(entry.product)),[cart,productsById]);
  const subtotal=useMemo(()=>cartDetails.reduce((sum,{item,product})=>sum+item.quantity*Number(product.price_cents),0),[cartDetails]);
  const itemCount=cart.reduce((sum,item)=>sum+item.quantity,0);
  const serializedItems=useMemo(()=>JSON.stringify(cart),[cart]);

  useEffect(()=>{
    let restored=normalizeCart(initialDraftRef.current?.items,initialProductsRef.current);
    try{
      const localDraft=window.localStorage.getItem(storageKey);
      if(localDraft){
        const parsed=JSON.parse(localDraft) as {items?:unknown};
        restored=normalizeCart(parsed.items,initialProductsRef.current);
      }
    }catch{
      try{window.localStorage.removeItem(storageKey);}catch{}
    }
    setCart(restored);
    setDraftReady(true);
    setDraftStatus(window.navigator.onLine?"saving":"local");
  },[storageKey]);

  useEffect(()=>{
    const retrySync=()=>{setDraftStatus("saving");setSyncAttempt((current)=>current+1);};
    window.addEventListener("online",retrySync);
    return()=>window.removeEventListener("online",retrySync);
  },[]);

  useEffect(()=>{
    if(!draftReady)return;
    void syncAttempt;
    const snapshot=cart.map(({productId,quantity})=>({productId,quantity}));
    const updatedAt=new Date().toISOString();
    try{window.localStorage.setItem(storageKey,JSON.stringify({items:snapshot,updatedAt}));}catch{}
    const revision=++saveRevisionRef.current;
    if(!window.navigator.onLine)return;
    const formData=new FormData();
    formData.set("quickSaleItems",JSON.stringify(snapshot));
    saveQueueRef.current=saveQueueRef.current.catch(()=>undefined).then(async()=>{
      try{
        const result=await saveQuickSaleDraftAction(formData);
        if(revision!==saveRevisionRef.current)return;
        if(!result.success){setDraftStatus("local");return;}
        setDraftStatus("saved");
        if(snapshot.length===0){
          try{
            const current=JSON.parse(window.localStorage.getItem(storageKey)||"null") as {updatedAt?:string}|null;
            if(current?.updatedAt===updatedAt)window.localStorage.removeItem(storageKey);
          }catch{}
        }
      }catch{
        if(revision===saveRevisionRef.current)setDraftStatus("local");
      }
    });
  },[cart,draftReady,storageKey,syncAttempt]);

  function markDraftChanged(){
    setDraftStatus(window.navigator.onLine?"saving":"local");
  }

  function setQuantity(productId:number,nextQuantity:number){
    const product=productsById.get(productId);
    if(!product)return;
    const max=maxCartQuantity(product);
    const quantity=Math.min(max,Math.max(0,Math.trunc(nextQuantity)||0));
    markDraftChanged();
    setCart((current)=>quantity<1?current.filter((item)=>item.productId!==productId):current.map((item)=>item.productId===productId?{...item,quantity}:item));
  }
  function addProduct(product:CommandProduct){
    if(!cashOpen||availableUnits(product)<1)return;
    markDraftChanged();
    setCart((current)=>{
      const existing=current.find((item)=>item.productId===product.id);
      if(existing)return current.map((item)=>item.productId===product.id?{...item,quantity:Math.min(maxCartQuantity(product),item.quantity+1)}:item);
      return[...current,{productId:product.id,quantity:1}];
    });
  }

  return <>
    {!cashOpen&&<div className="alert alert-error quick-sale-cash-alert"><strong>O caixa está fechado.</strong> Um Gerente ou Administrador precisa abrir o caixa antes de iniciar vendas rápidas.</div>}
    <div className="quick-sale-layout">
      <section className="card quick-sale-products-panel">
        <div className="quick-sale-section-head"><div><h3>1. Adicione os produtos</h3><p>Busque e toque em “Adicionar”. Ajuste as quantidades no carrinho.</p></div><span className="badge badge-gray">{filteredProducts.length} produto(s)</span></div>
        <div className="live-product-search">
          <Search className="live-search-icon" size={19}/>
          <input className="input" type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Nome ou categoria do produto" aria-label="Buscar produtos" autoComplete="off" autoFocus/>
          {query&&<button className="live-search-clear" type="button" onClick={()=>setQuery("")} aria-label="Limpar busca"><X size={18}/></button>}
        </div>
        {filteredProducts.length===0?<div className="empty product-search-empty">Nenhum produto encontrado.</div>:<div className="product-list quick-sale-product-list">
          {filteredProducts.map((product)=>{
            const stock=availableUnits(product);
            const currentQuantity=cart.find((item)=>item.productId===product.id)?.quantity||0;
            const unavailable=!product.stock_unlimited&&stock<1;
            return <article className={`product-button quick-sale-product-card ${currentQuantity>0?"selected":""}`} key={product.id}>
              {product.has_image?<Image className="command-product-photo" src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at??"1")}`} alt={product.name} width={220} height={120} unoptimized/>:<span className="command-product-photo command-product-photo-empty"><ImageIcon size={24}/></span>}
              <div className="quick-sale-product-copy"><strong>{product.name}</strong><small>{product.category} · {product.stock_unlimited?"Disponível sem limite":`${stock} un. disponível(is)`}</small></div>
              <div className="quick-sale-product-footer"><span className="money">{formatMoney(product.price_cents)}</span><button className="btn btn-primary btn-small" type="button" onClick={()=>addProduct(product)} disabled={!cashOpen||unavailable||currentQuantity>=maxCartQuantity(product)}><Plus size={15}/> {currentQuantity>0?`${currentQuantity} no carrinho`:unavailable?"Sem estoque":"Adicionar"}</button></div>
            </article>;
          })}
        </div>}
      </section>

      <aside className="card quick-sale-checkout-panel">
        <div className="quick-sale-section-head"><div><h3><ShoppingCart size={18}/> 2. Carrinho e pagamento</h3><p>{itemCount>0?`${itemCount} unidade(s) selecionada(s)`:"Adicione produtos para liberar o pagamento."}</p>{cart.length>0&&draftReady&&<small className={`quick-sale-draft-status ${draftStatus}`} aria-live="polite">{draftStatus==="saving"?<LoaderCircle size={14}/>:draftStatus==="local"?<CloudOff size={14}/>:<CloudCheck size={14}/>}<span>{draftStatus==="saving"?"Salvando rascunho...":draftStatus==="local"?"Salvo neste dispositivo; sincroniza ao reconectar":"Rascunho salvo automaticamente"}</span></small>}</div>{cart.length>0&&<button className="btn btn-light btn-small" type="button" onClick={()=>{markDraftChanged();setCart([]);}}><Trash2 size={14}/> Limpar</button>}</div>
        {cartDetails.length===0?<div className="empty quick-sale-cart-empty"><ShoppingCart size={28}/><strong>O carrinho está vazio</strong><span>Os produtos adicionados aparecerão aqui.</span></div>:<>
          <div className="quick-sale-cart-list">
            {cartDetails.map(({item,product})=><article className="quick-sale-cart-item" key={product.id}>
              <div><strong>{product.name}</strong><small>{formatMoney(product.price_cents)} por unidade</small></div>
              <div className="quick-sale-quantity-control"><button type="button" onClick={()=>setQuantity(product.id,item.quantity-1)} aria-label={`Diminuir ${product.name}`}><Minus size={15}/></button><input className="input" type="number" min="1" max={maxCartQuantity(product)} step="1" value={item.quantity} onChange={(event)=>setQuantity(product.id,Number(event.target.value))} aria-label={`Quantidade de ${product.name}`}/><button type="button" onClick={()=>setQuantity(product.id,item.quantity+1)} disabled={item.quantity>=maxCartQuantity(product)} aria-label={`Aumentar ${product.name}`}><Plus size={15}/></button></div>
              <div className="quick-sale-cart-line-total"><strong>{formatMoney(product.price_cents*item.quantity)}</strong><button type="button" onClick={()=>setQuantity(product.id,0)} aria-label={`Remover ${product.name}`}><Trash2 size={14}/></button></div>
            </article>)}
          </div>
          <div className="quick-sale-subtotal"><span>Subtotal do carrinho</span><strong>{formatMoney(subtotal)}</strong></div>
          <div className="divider"/>
          <PaymentForm mode="QUICK_SALE" quickSaleItems={serializedItems} subtotal={subtotal} staffMembers={staffMembers} customers={customers} canSubmit={cashOpen} onSuccess={()=>{try{window.localStorage.removeItem(storageKey);}catch{}setDraftStatus("saved");setCart([]);setQuery("");}}/>
        </>}
      </aside>
    </div>
  </>;
}
