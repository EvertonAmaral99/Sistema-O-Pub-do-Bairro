"use client";

import { useMemo, useState } from "react";
import { InfinityIcon, Link2, Unlink } from "lucide-react";

export type StockLinkOption = {
  id: number;
  name: string;
  stockPoolId: number;
  saleUnit: string;
  stockQuantity: number | string;
  minStock: number | string;
  unlimited: boolean;
};

type Props = {
  mode: "create" | "edit";
  options: StockLinkOption[];
  currentPoolId?: number;
  initialLinkedProductId?: number | null;
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

export function ProductStockFields({
  mode,
  options,
  currentPoolId,
  initialLinkedProductId = null,
  initialSaleUnit = "UNIT",
  storedStockFactor = "",
  initialStock = 0,
  initialMinStock = 0,
  initialUnlimited = false,
}: Props) {
  const [saleUnit,setSaleUnit]=useState(initialSaleUnit);
  const [linked,setLinked]=useState(Boolean(initialLinkedProductId));
  const [sourceId,setSourceId]=useState(initialLinkedProductId ? String(initialLinkedProductId) : "");
  const [unlimited,setUnlimited]=useState(initialUnlimited);
  const filteredOptions=useMemo(()=>options.filter((option)=>option.saleUnit===saleUnit),[options,saleUnit]);
  const source=options.find((option)=>String(option.id)===sourceId);
  const changingPool=linked&&Boolean(source)&&source?.stockPoolId!==currentPoolId;
  const stockLocked=linked&&(mode==="create"||changingPool);

  function toggleLink(){
    setLinked((value)=>!value);
    if(linked) setSourceId("");
    else setUnlimited(false);
  }

  return <>
    <div className="field"><label>Unidade do estoque</label><select className="select" name="saleUnit" value={saleUnit} onChange={(event)=>{setSaleUnit(event.target.value);setSourceId("");setLinked(false);}}>{units.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><small>Esta medida aparece somente no controle interno de estoque.</small></div>
    {String(storedStockFactor)!==""&&<input type="hidden" name="stockPerSaleUnit" value={String(storedStockFactor)}/>}

    <section className="stock-link-panel span-2">
      <div className="stock-link-head"><div><strong>Controle de estoque</strong><small>Use um saldo próprio, compartilhe com outro produto ou marque como ilimitado.</small></div><button className={`btn ${linked?"btn-light":"btn-primary"}`} type="button" onClick={toggleLink}>{linked?<><Unlink size={16}/> Usar estoque separado</>:<><Link2 size={16}/> Vincular estoque</>}</button></div>
      <input type="hidden" name="stockLinkEnabled" value={linked?"true":"false"}/>
      {linked&&<div className="field stock-source-field"><label>Produto que fornecerá o estoque</label><select className="select" name="stockSourceProductId" value={sourceId} onChange={(event)=>setSourceId(event.target.value)} required><option value="">Selecione o produto</option>{filteredOptions.map((option)=><option key={option.id} value={option.id}>{option.name}{option.unlimited?" — ilimitado":` — saldo ${Number(option.stockQuantity).toLocaleString("pt-BR",{maximumFractionDigits:3})}`}</option>)}</select><small>Os cadastros continuam separados, mas todas as baixas usam o mesmo saldo.</small></div>}
      {linked&&filteredOptions.length===0&&<div className="alert alert-info">Ainda não há outro produto com esta forma de controle.</div>}
      {changingPool&&<div className="alert alert-info">Ao salvar, este produto passará a usar o saldo selecionado. Os campos de quantidade e mínimo abaixo não serão aplicados.</div>}
    </section>

    <div className="field"><label>Quantidade em estoque</label><input className="input" name="stock" type="number" min="0" step="0.001" defaultValue={String(initialStock)} disabled={stockLocked||unlimited} required={!stockLocked&&!unlimited}/>{(stockLocked||unlimited)&&<input type="hidden" name="stock" value="0"/>}<small>{unlimited?"Produtos ilimitados não dependem de saldo.":stockLocked?"O saldo virá do produto vinculado.":"Saldo disponível para venda."}</small></div>
    <div className="field unlimited-stock-field"><label className="check-row"><input type="checkbox" name="unlimitedStock" checked={unlimited} disabled={stockLocked} onChange={(event)=>setUnlimited(event.target.checked)}/><InfinityIcon size={17}/> Estoque ilimitado</label><small>Use para fichas de jogos e itens que retornam ou não possuem quantidade fixa.</small></div>
    <div className="field"><label>Estoque mínimo</label><input className="input" name="minStock" type="number" min="0" step="0.001" defaultValue={String(initialMinStock)} disabled={stockLocked||unlimited} required={!stockLocked&&!unlimited}/>{(stockLocked||unlimited)&&<input type="hidden" name="minStock" value="0"/>}<small>{unlimited?"Desativado enquanto o estoque for ilimitado.":stockLocked?"O limite virá do produto vinculado.":"Ao atingir este valor, o item entra na lista de compras."}</small></div>
  </>;
}
