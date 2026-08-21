"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Banknote, CircleDollarSign } from "lucide-react";
import { PaymentForm as BasePaymentForm } from "@/components/payment-form-base";

export type { CustomerOption, StaffMemberOption } from "@/components/payment-form-base";

type PaymentFormProps=ComponentProps<typeof BasePaymentForm>;
type CashLine={key:string;label:string;appliedCents:number};

function moneyToCents(value:string){
  const normalized=String(value||"").trim().replace(",",".");
  const parsed=Number(normalized);
  return Number.isFinite(parsed)?Math.max(0,Math.round(parsed*100)):0;
}

function brl(cents:number){
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
}

function sameLines(left:CashLine[],right:CashLine[]){
  return left.length===right.length&&left.every((line,index)=>line.key===right[index]?.key&&line.label===right[index]?.label&&line.appliedCents===right[index]?.appliedCents);
}

export function PaymentForm(props:PaymentFormProps){
  const rootRef=useRef<HTMLDivElement>(null);
  const [cashLines,setCashLines]=useState<CashLine[]>([]);
  const [received,setReceived]=useState<Record<string,string>>({});
  const [portalTarget,setPortalTarget]=useState<HTMLElement|null>(null);

  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;

    const scan=()=>{
      const form=root.querySelector("form");
      if(!form)return;

      const discountInput=form.querySelector<HTMLInputElement>('input[name="discount"]');
      const serviceInput=form.querySelector<HTMLInputElement>('input[name="servicePercent"]');
      const discount=Math.min(props.subtotal,moneyToCents(discountInput?.value||"0"));
      const servicePercent=Math.min(100,Math.max(0,Number(String(serviceInput?.value||"0").replace(",","."))||0));
      const total=props.subtotal-discount+Math.round((props.subtotal-discount)*servicePercent/100);
      const nextLines:CashLine[]=[];

      const paymentRows=[...form.querySelectorAll<HTMLElement>(".split-payment-row")];
      if(paymentRows.length>0){
        paymentRows.forEach((row,index)=>{
          const method=row.querySelector<HTMLSelectElement>(`#payment-method-${index}`)?.value||row.querySelector<HTMLSelectElement>("select")?.value||"";
          const amountInput=row.querySelector<HTMLInputElement>(`#payment-amount-${index}`)||row.querySelector<HTMLInputElement>('input[type="number"]');
          const amount=moneyToCents(amountInput?.value||"");
          const amountLabel=row.querySelector<HTMLLabelElement>(`label[for="payment-amount-${index}"]`);
          if(amountLabel)amountLabel.textContent=method==="CASH"?"Valor da conta a abater (R$)":"Valor pago (R$)";
          if(method==="CASH"&&amount>0)nextLines.push({key:`row-${index}`,label:`${paymentRows.length>1?`Dinheiro — pagamento ${index+1}`:"Dinheiro"}`,appliedCents:amount});
        });
      }else{
        const selector=form.querySelector<HTMLElement>(".payment-method-selector");
        const selects=selector?[...selector.querySelectorAll<HTMLSelectElement>("select")]:[];
        const primaryMethod=selects[0]?.value||"";
        if(primaryMethod==="CASH"&&total>0){
          nextLines.push({key:"single",label:"Pagamento em dinheiro",appliedCents:total});
        }
        if(primaryMethod==="STORE_CREDIT"&&selects.length>1&&selects[1]?.value==="CASH"){
          const numericInputs=selector?[...selector.querySelectorAll<HTMLInputElement>('input[type="number"]')]:[];
          const storeCredit=Math.min(total,moneyToCents(numericInputs[0]?.value||""));
          const remainder=Math.max(0,total-storeCredit);
          if(remainder>0)nextLines.push({key:"remainder",label:"Saldo pago em dinheiro",appliedCents:remainder});
        }
      }

      setCashLines((current)=>sameLines(current,nextLines)?current:nextLines);
      setPortalTarget((current)=>{
        const next=form.querySelector<HTMLElement>(".payment-balance");
        return current===next?current:next;
      });
    };

    scan();
    const handleInput=()=>scan();
    root.addEventListener("input",handleInput,true);
    root.addEventListener("change",handleInput,true);
    const observer=new MutationObserver(()=>scan());
    observer.observe(root,{childList:true,subtree:true});
    return()=>{
      root.removeEventListener("input",handleInput,true);
      root.removeEventListener("change",handleInput,true);
      observer.disconnect();
    };
  },[props.subtotal]);

  useEffect(()=>{
    setReceived((current)=>{
      const keys=new Set(cashLines.map((line)=>line.key));
      const next=Object.fromEntries(Object.entries(current).filter(([key])=>keys.has(key)));
      return Object.keys(next).length===Object.keys(current).length?current:next;
    });
  },[cashLines]);

  const helper=cashLines.length>0?<div className="cash-change-helper">
    <div className="cash-change-helper-head"><Banknote size={18}/><div><strong>Troco em dinheiro</strong><small>O valor recebido serve só para calcular o troco. No caixa e no financeiro será abatido somente o valor da venda.</small></div></div>
    <div className="cash-change-lines">
      {cashLines.map((line)=>{
        const receivedValue=received[line.key]??"";
        const receivedCents=moneyToCents(receivedValue);
        const enough=receivedCents>=line.appliedCents;
        const change=Math.max(0,receivedCents-line.appliedCents);
        return <div className="cash-change-line" key={line.key}>
          <div className="cash-change-line-title"><span>{line.label}</span><strong>Abater {brl(line.appliedCents)}</strong></div>
          <div className="field"><label htmlFor={`cash-received-${line.key}`}>Valor recebido do cliente (R$)</label><input id={`cash-received-${line.key}`} className="input" type="number" min={(line.appliedCents/100).toFixed(2)} step="0.01" inputMode="decimal" value={receivedValue} onChange={(event)=>setReceived((current)=>({...current,[line.key]:event.target.value}))} placeholder={(line.appliedCents/100).toFixed(2)}/></div>
          <div className={`cash-change-result ${receivedValue&&!enough?"invalid":""}`}><CircleDollarSign size={17}/><span>{!receivedValue?<>Informe quanto o cliente entregou.</>:enough?<>Troco: <strong>{brl(change)}</strong> · A venda continua em <strong>{brl(line.appliedCents)}</strong>.</>:<>Faltam <strong>{brl(line.appliedCents-receivedCents)}</strong> para cobrir este pagamento.</>}</span></div>
        </div>;
      })}
    </div>
  </div>:null;

  return <div className="payment-form-wrapper" ref={rootRef}>
    <BasePaymentForm {...props}/>
    {helper&&portalTarget?createPortal(helper,portalTarget):helper}
  </div>;
}
