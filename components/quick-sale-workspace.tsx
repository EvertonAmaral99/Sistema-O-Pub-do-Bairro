"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudCheck, CloudOff, ImageIcon, ListTodo, LoaderCircle, Minus, Plus, Save, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { quickSaleAction, saveQuickSaleDraftAction } from "@/app/system-actions";
import { PaymentForm, type CustomerOption, type StaffMemberOption } from "@/components/payment-form";
import type { CommandProduct } from "@/components/command-product-picker";
import { formatMoney } from "@/lib/format";
import { emptyQuickSaleCheckoutDraft, normalizeQuickSaleCheckoutDraft, quickSalePendingLabel, type QuickSaleCheckoutDraft } from "@/lib/quick-sale-draft";

type CartItem={productId:number;quantity:number};
type QuickSalePendingDraft={id:number;items:unknown;checkoutState:unknown;updatedAt:string};
type DraftStatus="restoring"|"saving"|"saved"|"local";
type LocalDraftSnapshot={draftId:number|null;items:CartItem[];checkoutState:QuickSaleCheckoutDraft;updatedAt:string};
type DraftSaveResult={success?:boolean;draftId?:number|null;error?:string};

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

function validDraftId(value:unknown){
  const id=Math.trunc(Number(value));
  return Number.isSafeInteger(id)&&id>0?id:null;
}

export function QuickSaleWorkspace({products,staffMembers,customers,cashOpen,userId,initialDraft,forceNew=false}:{products:CommandProduct[];staffMembers:StaffMemberOption[];customers:CustomerOption[];cashOpen:boolean;userId:number;initialDraft:QuickSalePendingDraft|null;forceNew?:boolean}){
  const router=useRouter();
  const storageKey=`pub-quick-sale-pending-active-v2:${userId}`;
  const legacyStorageKey=`pub-quick-sale-draft-v1:${userId}`;
  const initialDraftRef=useRef(initialDraft);
  const initialProductsRef=useRef(products);
  const draftIdRef=useRef<number|null>(initialDraft?.id??null);
  const checkoutDraftRef=useRef<QuickSaleCheckoutDraft>(normalizeQuickSaleCheckoutDraft(initialDraft?.checkoutState));
  const saveQueueRef=useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef=useRef(0);
  const finalizingRef=useRef(false);
  const [query,setQuery]=useState("");
  const [cart,setCart]=useState<CartItem[]>(()=>normalizeCart(initialDraft?.items,products));
  const [draftId,setDraftId]=useState<number|null>(initialDraft?.id??null);
  const [checkoutDraft,setCheckoutDraft]=useState<QuickSaleCheckoutDraft>(()=>normalizeQuickSaleCheckoutDraft(initialDraft?.checkoutState));
  const [paymentFormKey,setPaymentFormKey]=useState(0);
  const [draftReady,setDraftReady]=useState(false);
  const [draftStatus,setDraftStatus]=useState<DraftStatus>("restoring");
  const [draftMessage,setDraftMessage]=useState("");
  const [syncAttempt,setSyncAttempt]=useState(0);
  const [leaving,setLeaving]=useState(false);
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

  const enqueueDraftSave=useCallback((snapshot:LocalDraftSnapshot,revision:number):Promise<DraftSaveResult>=>{
    const operation=saveQueueRef.current.catch(()=>undefined).then(async()=>{
      try{
        const formData=new FormData();
        const currentDraftId=draftIdRef.current;
        if(currentDraftId!==null)formData.set("quickSaleDraftId",String(currentDraftId));
        formData.set("quickSaleItems",JSON.stringify(snapshot.items));
        formData.set("quickSaleCheckout",JSON.stringify(snapshot.checkoutState));
        const result=await saveQuickSaleDraftAction(formData);
        if(!result.success){
          if(revision===saveRevisionRef.current){setDraftStatus("local");setDraftMessage(result.error||"O pedido ficou salvo apenas neste dispositivo.");}
          return result;
        }
        const nextDraftId=result.draftId??null;
        if(draftIdRef.current!==nextDraftId){draftIdRef.current=nextDraftId;setDraftId(nextDraftId);}
        const url=new URL(window.location.href);
        url.searchParams.delete("nova");
        if(nextDraftId!==null)url.searchParams.set("rascunho",String(nextDraftId));else url.searchParams.delete("rascunho");
        window.history.replaceState(window.history.state,"",url);
        if(revision===saveRevisionRef.current){
          setDraftStatus("saved");setDraftMessage("");
          try{
            if(nextDraftId===null)window.localStorage.removeItem(storageKey);
            else window.localStorage.setItem(storageKey,JSON.stringify({...snapshot,draftId:nextDraftId}));
          }catch{}
        }
        return result;
      }catch{
        const result={error:"Não foi possível sincronizar o pedido agora. Ele continua salvo neste dispositivo."};
        if(revision===saveRevisionRef.current){setDraftStatus("local");setDraftMessage(result.error);}
        return result;
      }
    });
    saveQueueRef.current=operation.then(()=>undefined,()=>undefined);
    return operation;
  },[storageKey]);

  useEffect(()=>{
    const serverDraft=initialDraftRef.current;
    let restoredDraftId=serverDraft?.id??null;
    let restoredCart=normalizeCart(serverDraft?.items,initialProductsRef.current);
    let restoredCheckout=normalizeQuickSaleCheckoutDraft(serverDraft?.checkoutState);
    try{
      const localDraft=forceNew?null:window.localStorage.getItem(storageKey);
      if(localDraft){
        const parsed=JSON.parse(localDraft) as Partial<LocalDraftSnapshot>;
        const localDraftId=validDraftId(parsed.draftId);
        if(serverDraft===null||localDraftId===serverDraft.id){
          restoredDraftId=localDraftId;
          restoredCart=normalizeCart(parsed.items,initialProductsRef.current);
          restoredCheckout=normalizeQuickSaleCheckoutDraft(parsed.checkoutState);
        }
      }
    }catch{
      try{window.localStorage.removeItem(storageKey);}catch{}
    }
    if(forceNew)try{window.localStorage.removeItem(storageKey);}catch{}
    try{window.localStorage.removeItem(legacyStorageKey);}catch{}
    draftIdRef.current=restoredDraftId;
    checkoutDraftRef.current=restoredCheckout;
    setDraftId(restoredDraftId);
    setCart(restoredCart);
    setCheckoutDraft(restoredCheckout);
    setPaymentFormKey((current)=>current+1);
    setDraftReady(true);
    setDraftStatus(window.navigator.onLine?"saving":"local");
  },[forceNew,legacyStorageKey,storageKey]);

  useEffect(()=>{
    const retrySync=()=>{setDraftStatus("saving");setDraftMessage("");setSyncAttempt((current)=>current+1);};
    window.addEventListener("online",retrySync);
    return()=>window.removeEventListener("online",retrySync);
  },[]);

  useEffect(()=>{
    if(!draftReady||finalizingRef.current)return;
    void syncAttempt;
    const snapshot:LocalDraftSnapshot={draftId:draftIdRef.current,items:cart.map(({productId,quantity})=>({productId,quantity})),checkoutState:checkoutDraft,updatedAt:new Date().toISOString()};
    try{window.localStorage.setItem(storageKey,JSON.stringify(snapshot));}catch{}
    const revision=++saveRevisionRef.current;
    if(!window.navigator.onLine)return;
    void enqueueDraftSave(snapshot,revision);
  },[cart,checkoutDraft,draftReady,enqueueDraftSave,storageKey,syncAttempt]);

  const handleCheckoutDraftChange=useCallback((nextDraft:QuickSaleCheckoutDraft)=>{
    const normalized=normalizeQuickSaleCheckoutDraft(nextDraft);
    if(JSON.stringify(checkoutDraftRef.current)===JSON.stringify(normalized))return;
    checkoutDraftRef.current=normalized;
    setCheckoutDraft(normalized);
    setDraftStatus(window.navigator.onLine?"saving":"local");
    setDraftMessage("");
  },[]);

  function markDraftChanged(){
    setDraftStatus(window.navigator.onLine?"saving":"local");
    setDraftMessage("");
  }

  function resetCheckout(){
    const emptyDraft=emptyQuickSaleCheckoutDraft();
    checkoutDraftRef.current=emptyDraft;
    setCheckoutDraft(emptyDraft);
    setPaymentFormKey((current)=>current+1);
  }

  function setQuantity(productId:number,nextQuantity:number){
    const product=productsById.get(productId);
    if(!product)return;
    const max=maxCartQuantity(product);
    const quantity=Math.min(max,Math.max(0,Math.trunc(nextQuantity)||0));
    if(quantity<1&&cart.length===1&&cart[0]?.productId===productId)resetCheckout();
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

  function clearCart(){
    markDraftChanged();
    resetCheckout();
    setCart([]);
  }

  async function saveAndLeavePending(){
    if(cart.length===0||leaving)return;
    const snapshot:LocalDraftSnapshot={draftId:draftIdRef.current,items:cart.map(({productId,quantity})=>({productId,quantity})),checkoutState:checkoutDraftRef.current,updatedAt:new Date().toISOString()};
    try{window.localStorage.setItem(storageKey,JSON.stringify(snapshot));}catch{}
    if(!window.navigator.onLine){setDraftStatus("local");setDraftMessage("Sem conexão: o pedido está seguro neste dispositivo e será enviado quando a internet voltar.");return;}
    setLeaving(true);setDraftStatus("saving");setDraftMessage("");
    const revision=++saveRevisionRef.current;
    try{
      const result=await enqueueDraftSave(snapshot,revision);
      if(result.success&&result.draftId){
        try{window.localStorage.removeItem(storageKey);}catch{}
        router.push("/pendencias-venda");
      }
    }finally{setLeaving(false);}
  }

  const submitQuickSale=useCallback(async(formData:FormData):Promise<{url?:string;error?:string}>=>{
    if(finalizingRef.current)return{error:"A venda já está sendo finalizada."};
    finalizingRef.current=true;
    const snapshot:LocalDraftSnapshot={draftId:draftIdRef.current,items:cart.map(({productId,quantity})=>({productId,quantity})),checkoutState:checkoutDraftRef.current,updatedAt:new Date().toISOString()};
    const revision=++saveRevisionRef.current;
    setDraftStatus("saving");setDraftMessage("");
    try{
      const saved=await enqueueDraftSave(snapshot,revision);
      if(!saved.success||!saved.draftId){
        finalizingRef.current=false;
        return{error:saved.error||"Não foi possível salvar a pendência antes de finalizar."};
      }
      formData.set("quickSaleDraftId",String(saved.draftId));
      const result=await quickSaleAction(formData);
      if(!result.url)finalizingRef.current=false;
      return result;
    }catch{
      finalizingRef.current=false;
      return{error:"Não foi possível concluir a venda rápida."};
    }
  },[cart,enqueueDraftSave]);

  function finishSale(){
    try{window.localStorage.removeItem(storageKey);}catch{}
    const emptyDraft=emptyQuickSaleCheckoutDraft();
    finalizingRef.current=false;
    draftIdRef.current=null;checkoutDraftRef.current=emptyDraft;
    setDraftId(null);setDraftStatus("saved");setDraftMessage("");setCheckoutDraft(emptyDraft);setCart([]);setQuery("");setPaymentFormKey((current)=>current+1);
  }

  return <>
    {!cashOpen&&<div className="alert alert-error quick-sale-cash-alert"><strong>O caixa está fechado.</strong> Um Gerente ou Administrador precisa abrir o caixa antes de iniciar vendas rápidas.</div>}
    {draftMessage&&<div className="alert alert-info quick-sale-draft-message">{draftMessage}</div>}
    <div className="card quick-sale-pending-toolbar">
      <div className="quick-sale-pending-identity"><Save size={20}/><div><strong>{draftId?`Pedido ${quickSalePendingLabel(draftId)}`:"Nova venda rápida"}</strong><small>{draftId?"Toda alteração é atualizada automaticamente nas Pendências de venda.":"Ao adicionar o primeiro produto, um pedido pendente numerado será criado automaticamente."}</small></div></div>
      <div className="actions"><Link className="btn btn-light btn-small" href="/pendencias-venda"><ListTodo size={15}/> Ver pendências</Link><button className="btn btn-primary btn-small" type="button" onClick={saveAndLeavePending} disabled={cart.length===0||leaving}>{leaving?<LoaderCircle className="quick-sale-saving-icon" size={15}/>:<Save size={15}/>} Salvar e deixar pendente</button></div>
    </div>
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
        <div className="quick-sale-section-head"><div><h3><ShoppingCart size={18}/> 2. Carrinho e pagamento</h3><p>{itemCount>0?`${itemCount} unidade(s) selecionada(s)`:"Adicione produtos para liberar o pagamento."}</p>{cart.length>0&&draftReady&&<small className={`quick-sale-draft-status ${draftStatus}`} aria-live="polite">{draftStatus==="saving"?<LoaderCircle size={14}/>:draftStatus==="local"?<CloudOff size={14}/>:<CloudCheck size={14}/>}<span>{draftStatus==="saving"?(draftId?"Atualizando pedido pendente...":"Criando pedido pendente..."):draftStatus==="local"?"Salvo neste dispositivo; sincroniza ao reconectar":draftId?`${quickSalePendingLabel(draftId)} salvo nas Pendências de venda`:"Pedido salvo automaticamente"}</span></small>}</div>{cart.length>0&&<button className="btn btn-light btn-small" type="button" onClick={clearCart}><Trash2 size={14}/> Limpar</button>}</div>
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
          <PaymentForm key={paymentFormKey} mode="QUICK_SALE" quickSaleItems={serializedItems} quickSaleDraftId={draftId} initialQuickSaleDraft={checkoutDraft} onQuickSaleDraftChange={handleCheckoutDraftChange} quickSaleSubmitAction={submitQuickSale} subtotal={subtotal} staffMembers={staffMembers} customers={customers} canSubmit={cashOpen} onSuccess={finishSale}/>
        </>}
      </aside>
    </div>
  </>;
}
