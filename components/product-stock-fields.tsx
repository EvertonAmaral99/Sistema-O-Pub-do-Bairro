"use client";

import { useState } from "react";
import { Beer, InfinityIcon, Package } from "lucide-react";

export type DraftStockPool = {
  stockKind: "DRAFT_BEER" | "DRAFT_WINE";
  stockQuantity: number | string;
};

type StockMode = "OWN" | "DRAFT_BEER" | "DRAFT_WINE" | "UNLIMITED";

type Props = {
  draftPools: DraftStockPool[];
  initialStockKind?: string | null;
  initialSaleUnit?: string;
  storedStockFactor?: number | string;
  initialStock?: number | string;
  initialMinStock?: number | string;
  initialUnlimited?: boolean;
};

const units = [
  ["UNIT", "Unidade"],
  ["KG", "Quilograma (kg)"],
  ["L", "Litro (L)"],
  ["PORTION", "Porção"],
  ["DOSE", "Dose"],
  ["BOTTLE", "Garrafa"],
  ["CAN", "Lata"],
] as const;

const stockModeLabels: Record<StockMode,string> = {
  OWN: "Estoque próprio deste produto",
  DRAFT_BEER: "CHOPP CERVEJA — galão de 50 L",
  DRAFT_WINE: "CHOPP VINHO — galão de 50 L",
  UNLIMITED: "Estoque ilimitado",
};

export function ProductStockFields({
  draftPools,
  initialStockKind = null,
  initialSaleUnit = "UNIT",
  storedStockFactor = "",
  initialStock = 0,
  initialMinStock = 0,
  initialUnlimited = false,
}: Props) {
  const initialMode:StockMode = initialStockKind === "DRAFT_BEER" || initialStockKind === "DRAFT_WINE"
    ? initialStockKind
    : initialUnlimited ? "UNLIMITED" : "OWN";
  const [mode,setMode]=useState<StockMode>(initialMode);
  const [saleUnit,setSaleUnit]=useState(initialSaleUnit);
  const isDraft=mode==="DRAFT_BEER"||mode==="DRAFT_WINE";
  const selectedPool=isDraft?draftPools.find((pool)=>pool.stockKind===mode):undefined;
  const storedMilliliters=Math.round(Number(storedStockFactor)*1000);
  const initialMilliliters=[190,300,500].includes(storedMilliliters)?String(storedMilliliters):"500";
  const ownInitialStock=initialMode==="OWN"?initialStock:0;
  const ownInitialMinStock=initialMode==="OWN"?initialMinStock:0;

  return <>
    <section className="stock-link-panel span-2">
      <div className="stock-link-head"><div><strong>Como controlar o estoque?</strong><small>Os copos são vendidos por unidade. Somente a baixa interna dos chopes é calculada em litros.</small></div></div>
      <div className="stock-mode-grid">
        {(Object.keys(stockModeLabels) as StockMode[]).map((value)=><label className="stock-mode-option" key={value}>
          <input type="radio" name="stockMode" value={value} checked={mode===value} onChange={()=>setMode(value)}/>
          {value==="OWN"?<Package size={18}/>:value==="UNLIMITED"?<InfinityIcon size={18}/>:<Beer size={18}/>}
          <span>{stockModeLabels[value]}</span>
        </label>)}
      </div>
      {isDraft&&<div className="draft-stock-choice">
        <div className="field"><label>Tamanho servido por unidade</label><select className="select" name="servingMilliliters" defaultValue={initialMilliliters}><option value="190">190 ml</option><option value="300">300 ml</option><option value="500">500 ml</option></select></div>
        <div className="draft-stock-summary"><Beer size={20}/><div><strong>{mode==="DRAFT_BEER"?"Estoque de CHOPP CERVEJA":"Estoque de CHOPP VINHO"}</strong><small>Saldo atual: {Number(selectedPool?.stockQuantity??0).toLocaleString("pt-BR",{maximumFractionDigits:3})} L. Cada venda baixará o volume escolhido acima.</small></div></div>
      </div>}
      {mode==="UNLIMITED"&&<div className="alert alert-info">Este produto não terá saldo nem estoque mínimo.</div>}
    </section>

    {mode==="OWN"&&<>
      <div className="field"><label>Unidade do estoque</label><select className="select" name="saleUnit" value={saleUnit} onChange={(event)=>setSaleUnit(event.target.value)}>{units.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><small>Esta medida aparece somente no controle interno.</small></div>
      <div className="field"><label>Quantidade em estoque</label><input className="input" name="stock" type="number" min="0" step="0.001" defaultValue={String(ownInitialStock)} required/><small>Saldo disponível para venda.</small></div>
      <div className="field"><label>Estoque mínimo</label><input className="input" name="minStock" type="number" min="0" step="0.001" defaultValue={String(ownInitialMinStock)} required/><small>Ao atingir este valor, o item entra na lista de compras.</small></div>
    </>}
    {mode!=="OWN"&&<><input type="hidden" name="saleUnit" value={isDraft?"L":"UNIT"}/><input type="hidden" name="stock" value="0"/><input type="hidden" name="minStock" value="0"/></>}
  </>;
}
