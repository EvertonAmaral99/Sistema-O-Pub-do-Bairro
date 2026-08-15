"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { updateProductFinancialsAction } from "@/app/system-actions";

function numberValue(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function marginFrom(cost: number, price: number) {
  return price > 0 ? ((price - cost) / price) * 100 : 0;
}

export function ProductMarginEditor({ productId, initialCostCents, initialPriceCents }: { productId:number; initialCostCents:number; initialPriceCents:number }) {
  const [cost,setCost]=useState((initialCostCents/100).toFixed(2));
  const [price,setPrice]=useState((initialPriceCents/100).toFixed(2));
  const [margin,setMargin]=useState(marginFrom(initialCostCents,initialPriceCents).toFixed(2));
  const costValue=numberValue(cost);
  const priceValue=numberValue(price);
  const profit=priceValue-costValue;

  function changeCost(value:string){
    setCost(value);
    setMargin(marginFrom(numberValue(value)*100,priceValue*100).toFixed(2));
  }
  function changePrice(value:string){
    setPrice(value);
    setMargin(marginFrom(costValue*100,numberValue(value)*100).toFixed(2));
  }
  function changeMargin(value:string){
    setMargin(value);
    const parsed=Number(value.replace(",","."));
    if(Number.isFinite(parsed)&&parsed<100){
      const calculated=costValue/(1-parsed/100);
      if(Number.isFinite(calculated)&&calculated>=0) setPrice(calculated.toFixed(2));
    }
  }

  return <form action={updateProductFinancialsAction} className="finance-product-form">
    <input type="hidden" name="productId" value={productId}/>
    <label><span>Custo (R$)</span><input className="input" name="cost" type="number" min="0" step="0.01" value={cost} onChange={(event)=>changeCost(event.target.value)} required/></label>
    <label><span>Margem (%)</span><input className="input" name="margin" type="number" max="99.99" step="0.01" value={margin} onChange={(event)=>changeMargin(event.target.value)} required/></label>
    <label><span>Venda (R$)</span><input className="input" name="price" type="number" min="0" step="0.01" value={price} onChange={(event)=>changePrice(event.target.value)} required/></label>
    <div className={`finance-unit-profit ${profit<0?"finance-negative":""}`}><span>Lucro por unidade</span><strong>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(profit)}</strong></div>
    <button className="btn btn-primary btn-small" type="submit"><Save size={14}/> Salvar</button>
  </form>;
}
