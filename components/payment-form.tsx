"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Banknote, CircleDollarSign } from "lucide-react";
import { PaymentForm as BasePaymentForm } from "@/components/payment-form-base";

export type { CustomerOption, StaffMemberOption } from "@/components/payment-form-base";

type PaymentFormProps=ComponentProps<typeof BasePaymentForm>;
type CashLine={
  key:string;
  label:string;
  appliedCents:number;
  dueCents?:number;
  inline?:boolean;
  target?:HTMLElement|null;
};

function moneyToCents(value:string){
  const normalized=String(value||"").trim().replace(",",".");
  const parsed=Number(normalized);
  return Number.isFinite(parsed)?Math.max(0,Math.round(parsed*100)):0;
}

function centsInput(cents:number){
  return (Math.max(0,cents)/100).toFixed(2);
}

function brl(cents:number){
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
}

function sameLines(left:CashLine[],right:CashLine[]){
  return left.length===right.length&&left.every((line,index)=>{
    const other=right[index];
    return line.key===other?.key&&
      line.label===other.label&&
      line.appliedCents===other.appliedCents&&
      line.dueCents===other.dueCents&&
      line.inline===other.inline&&
      line.target===other.target;
  });
}

function setReactNumberInput(input:HTMLInputElement,value:string){
  if(input.value===value)return;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);
  else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
}

export function PaymentForm(props:PaymentFormProps){
  const rootRef=useRef<HTMLDivElement>(null);
  const receivedRef=useRef<Record<string,string>>({});
  const [cashLines,setCashLines]=useState<CashLine[]>([]);
  const [received,setReceived]=useState<Record<string,string>>({});
  const [portalTarget,setPortalTarget]=useState<HTMLElement|null>(null);

  function updateReceived(key:string,value:string){
    const next={...receivedRef.current,[key]:value};
    receivedRef.current=next;
    setReceived(next);
  }

  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;

    let frame:number|null=null;

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
      const isMixed=Boolean(form.querySelector(".mixed-payment-head"));

      if(paymentRows.length>0&&isMixed){
        const rows=paymentRows.map((row,index)=>({
          row,
          index,
          method:row.querySelector<HTMLSelectElement>(`#payment-method-${index}`)?.value||row.querySelector<HTMLSelectElement>("select")?.value||"",
          amountInput:row.querySelector<HTMLInputElement>(`#payment-amount-${index}`)||row.querySelector<HTMLInputElement>('input[type="number"]'),
        }));

        const nonCashTotal=rows.reduce((sum,item)=>{
          if(!item.method||item.method==="CASH")return sum;
          return sum+moneyToCents(item.amountInput?.value||"");
        },0);
        let cashDue=Math.max(0,total-nonCashTotal);

        rows.forEach((item)=>{
          const amountField=item.amountInput?.closest(".field") as HTMLElement|null;
          let slot=item.row.querySelector<HTMLElement>(".mixed-cash-received-slot");

          if(item.method==="CASH"){
            if(amountField)amountField.style.display="none";
            if(!slot){
              slot=document.createElement("div");
              slot.className="mixed-cash-received-slot";
              item.row.appendChild(slot);
            }

            const key=`mixed-${item.index}`;
            const receivedValue=receivedRef.current[key]??"";
            const receivedCents=moneyToCents(receivedValue);
            const dueBefore=cashDue;
            const appliedCents=Math.min(receivedCents,dueBefore);
            cashDue=Math.max(0,cashDue-appliedCents);

            if(item.amountInput){
              setReactNumberInput(item.amountInput,appliedCents>0?centsInput(appliedCents):"");
            }

            nextLines.push({
              key,
              label:`Dinheiro — pagamento ${item.index+1}`,
              appliedCents,
              dueCents:dueBefore,
              inline:true,
              target:slot,
            });
          }else{
            if(amountField)amountField.style.display="";
            slot?.remove();
          }
        });
      }else if(paymentRows.length>0){
        paymentRows.forEach((row,index)=>{
          const amountInput=row.querySelector<HTMLInputElement>(`#payment-amount-${index}`)||row.querySelector<HTMLInputElement>('input[type="number"]');
          const amountField=amountInput?.closest(".field") as HTMLElement|null;
          if(amountField)amountField.style.display="";
          row.querySelector<HTMLElement>(".mixed-cash-received-slot")?.remove();

          const method=row.querySelector<HTMLSelectElement>(`#payment-method-${index}`)?.value||row.querySelector<HTMLSelectElement>("select")?.value||"";
          const amount=moneyToCents(amountInput?.value||"");
          if(method==="CASH"&&amount>0){
            nextLines.push({
              key:`row-${index}`,
              label:paymentRows.length>1?`Dinheiro — pagamento ${index+1}`:"Dinheiro",
              appliedCents:amount,
            });
          }
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

    const scheduleScan=()=>{
      if(frame!==null)cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        frame=null;
        scan();
      });
    };

    scheduleScan();
    root.addEventListener("input",scheduleScan,true);
    root.addEventListener("change",scheduleScan,true);
    root.addEventListener("click",scheduleScan,true);

    return()=>{
      root.removeEventListener("input",scheduleScan,true);
      root.removeEventListener("change",scheduleScan,true);
      root.removeEventListener("click",scheduleScan,true);
      if(frame!==null)cancelAnimationFrame(frame);
    };
  },[props.subtotal]);

  useEffect(()=>{
    const keys=new Set(cashLines.map((line)=>line.key));
    const next=Object.fromEntries(Object.entries(receivedRef.current).filter(([key])=>keys.has(key)));
    if(Object.keys(next).length!==Object.keys(receivedRef.current).length){
      receivedRef.current=next;
      setReceived(next);
    }
  },[cashLines]);

  function renderCashLine(line:CashLine){
    const receivedValue=received[line.key]??"";
    const receivedCents=moneyToCents(receivedValue);
    const dueCents=line.inline?(line.dueCents??0):line.appliedCents;
    const enough=dueCents>0&&receivedCents>=dueCents;
    const change=Math.max(0,receivedCents-dueCents);
    const missing=Math.max(0,dueCents-receivedCents);

    return <div className={`cash-change-line ${line.inline?"cash-change-line-inline":""}`} key={line.key}>
      <div className="cash-change-line-title">
        <span>{line.label}</span>
        <strong>{dueCents>0?`Abater ${brl(line.inline?Math.min(receivedCents,dueCents):dueCents)}`:"Sem saldo a abater"}</strong>
      </div>
      <div className="field">
        <label htmlFor={`cash-received-${line.key}`}>Valor recebido do cliente (R$)</label>
        <input
          id={`cash-received-${line.key}`}
          className="input"
          type="number"
          min={line.inline?"0.01":(line.appliedCents/100).toFixed(2)}
          step="0.01"
          inputMode="decimal"
          value={receivedValue}
          onChange={(event)=>updateReceived(line.key,event.target.value)}
          placeholder={dueCents>0?(dueCents/100).toFixed(2):"0.00"}
          required={Boolean(line.inline)}
        />
      </div>
      <div className={`cash-change-result ${receivedValue&&dueCents>0&&!enough?"invalid":""}`}>
        <CircleDollarSign size={17}/>
        <span>
          {dueCents<=0?<>A conta já está coberta pelas outras formas. Remova esta linha de dinheiro.</>:
          !receivedValue?<>Faltam <strong>{brl(dueCents)}</strong> em dinheiro. Digite somente quanto o cliente entregou.</>:
          enough?<>Troco: <strong>{brl(change)}</strong> · Na venda serão abatidos somente <strong>{brl(dueCents)}</strong>.</>:
          <>Serão abatidos <strong>{brl(receivedCents)}</strong> e ainda faltam <strong>{brl(missing)}</strong> para completar esta parte.</>}
        </span>
      </div>
    </div>;
  }

  const inlineHelpers=cashLines
    .filter((line)=>line.inline&&line.target)
    .map((line)=>createPortal(renderCashLine(line),line.target as HTMLElement,line.key));

  const regularLines=cashLines.filter((line)=>!line.inline);
  const helper=regularLines.length>0?<div className="cash-change-helper">
    <div className="cash-change-helper-head"><Banknote size={18}/><div><strong>Troco em dinheiro</strong><small>O valor recebido serve só para calcular o troco. No caixa e no financeiro será abatido somente o valor da venda.</small></div></div>
    <div className="cash-change-lines">{regularLines.map(renderCashLine)}</div>
  </div>:null;

  return <div className="payment-form-wrapper" ref={rootRef}>
    <BasePaymentForm {...props}/>
    {inlineHelpers}
    {helper&&portalTarget?createPortal(helper,portalTarget):helper}
  </div>;
}
