"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDollarSign, Printer, Users } from "lucide-react";
import { closeCommandAction } from "@/app/system-actions";
import { PrintActionForm } from "@/components/print-action-form";

function toCents(value: string) { const n=Number(value||0); return Number.isFinite(n)?Math.round(n*100):0; }
function brl(cents:number){ return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100); }

type PaymentMethod="CASH"|"PIX"|"DEBIT"|"CREDIT"|"STAFF_VOUCHER";
type SplitPayment={method:PaymentMethod|"";amount:string};

const paymentMethods:Array<{value:PaymentMethod;label:string}>=[
  {value:"PIX",label:"PIX"},
  {value:"CASH",label:"Dinheiro"},
  {value:"DEBIT",label:"Cartão de débito"},
  {value:"CREDIT",label:"Cartão de crédito"},
  {value:"STAFF_VOUCHER",label:"Vale funcionário"},
];

function emptyPaymentTotals():Record<PaymentMethod,number>{
  return{CASH:0,PIX:0,DEBIT:0,CREDIT:0,STAFF_VOUCHER:0};
}

function centsInput(cents:number){ return (cents/100).toFixed(2); }

export function PaymentForm({commandId,subtotal}:{commandId:number;subtotal:number}){
  const [discount,setDiscount]=useState("0");
  const [service,setService]=useState("0");
  const [splitCount,setSplitCount]=useState("1");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod|"">("");
  const [splitPayments,setSplitPayments]=useState<SplitPayment[]>([]);
  const calculation=useMemo(()=>{
    const discountCents=Math.min(toCents(discount),subtotal);
    const serviceCents=Math.round((subtotal-discountCents)*Math.max(0,Number(service)||0)/100);
    const total=subtotal-discountCents+serviceCents;
    const people=Math.min(50,Math.max(1,Math.trunc(Number(splitCount)||1)));
    const paymentTotals=emptyPaymentTotals();
    if(people===1&&paymentMethod) paymentTotals[paymentMethod]=total;
    if(people>1){
      for(const payment of splitPayments.slice(0,people)){
        if(payment.method) paymentTotals[payment.method]+=toCents(payment.amount);
      }
    }
    const paid=Object.values(paymentTotals).reduce((sum,value)=>sum+value,0);
    const remaining=total-paid;
    const progress=total>0?Math.min(100,Math.max(0,(paid/total)*100)):0;
    return{discountCents,serviceCents,total,paid,people,perPerson:Math.round(total/people),remaining,progress,paymentTotals};
  },[discount,service,paymentMethod,splitPayments,splitCount,subtotal]);
  const splitRowsComplete=calculation.people===1||Array.from({length:calculation.people},(_,index)=>splitPayments[index]).every((payment)=>Boolean(payment?.method)&&toCents(payment?.amount||"")>0);
  const paymentComplete=calculation.total>0&&calculation.remaining===0&&Boolean(paymentMethod||calculation.people>1)&&splitRowsComplete;

  function updateSplitPayment(index:number,patch:Partial<SplitPayment>){
    setSplitPayments((current)=>{
      const next=Array.from({length:Math.max(current.length,index+1)},(_,rowIndex)=>current[rowIndex]||{method:"",amount:""});
      next[index]={...next[index],...patch};
      return next;
    });
  }

  return <PrintActionForm action={closeCommandAction} className="form-stack">
    <input type="hidden" name="commandId" value={commandId}/>
    <div className="form-grid"><div className="field"><label>Desconto (R$)</label><input className="input" name="discount" type="number" min="0" step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)}/></div><div className="field"><label>Taxa de serviço (%) — opcional</label><input className="input" name="servicePercent" type="number" min="0" max="100" step="0.01" value={service} onChange={e=>setService(e.target.value)}/></div></div>
    <div className="card payment-summary"><div className="totals"><div className="total-row"><span>Subtotal</span><span>{brl(subtotal)}</span></div>{calculation.discountCents>0&&<div className="total-row"><span>Desconto</span><span>- {brl(calculation.discountCents)}</span></div>}{calculation.serviceCents>0&&<div className="total-row"><span>Taxa</span><span>{brl(calculation.serviceCents)}</span></div>}<div className="total-row grand"><span>Total</span><span>{brl(calculation.total)}</span></div></div></div>

    <div className="split-calculator"><div className="field"><label><Users size={14}/> Dividir entre quantas pessoas?</label><input className="input" name="splitCount" type="number" min="1" max="50" step="1" value={splitCount} onChange={e=>setSplitCount(e.target.value)}/></div><div><small>Valor por pessoa</small><strong>{brl(calculation.perPerson)}</strong>{calculation.total%calculation.people!==0&&<small>A última parte pode ter ajuste de centavos.</small>}</div></div>

    <p className="label payment-label">FORMAS DE PAGAMENTO</p>
    {calculation.people===1?(
      <div className="field payment-method-selector">
        <label>Selecione a forma de pagamento</label>
        <select className="select" value={paymentMethod} onChange={(event)=>setPaymentMethod(event.target.value as PaymentMethod|"")} required>
          <option value="">Selecione</option>
          {paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}
        </select>
        <small>{paymentMethod?`O valor de ${brl(calculation.total)} será lançado automaticamente.`:"Escolha uma opção para lançar o total da conta."}</small>
      </div>
    ):(
      <div className="split-payment-list">
        {Array.from({length:calculation.people},(_,index)=>{
          const payment=splitPayments[index]||{method:"",amount:""};
          return <div className="split-payment-row" key={index}>
            <strong>Pessoa {index+1}</strong>
            <div className="field"><label htmlFor={`payment-method-${index}`}>Forma de pagamento</label><select className="select" id={`payment-method-${index}`} value={payment.method} onChange={(event)=>updateSplitPayment(index,{method:event.target.value as PaymentMethod|""})} required><option value="">Selecione</option>{paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div>
            <div className="field"><label htmlFor={`payment-amount-${index}`}>Valor pago (R$)</label><input className="input" id={`payment-amount-${index}`} type="number" min="0.01" step="0.01" placeholder={centsInput(calculation.perPerson)} value={payment.amount} onChange={(event)=>updateSplitPayment(index,{amount:event.target.value})} required/></div>
          </div>;
        })}
        <small className="split-payment-help">Informe como cada pessoa pagou. O sistema agrupa os valores automaticamente no fechamento do caixa.</small>
      </div>
    )}
    <input type="hidden" name="cash" value={centsInput(calculation.paymentTotals.CASH)}/>
    <input type="hidden" name="pix" value={centsInput(calculation.paymentTotals.PIX)}/>
    <input type="hidden" name="debit" value={centsInput(calculation.paymentTotals.DEBIT)}/>
    <input type="hidden" name="credit" value={centsInput(calculation.paymentTotals.CREDIT)}/>
    <input type="hidden" name="staffVoucher" value={centsInput(calculation.paymentTotals.STAFF_VOUCHER)}/>
    <section className={`payment-balance ${paymentComplete?"payment-balance-complete":calculation.remaining<0?"payment-balance-over":""}`} aria-live="polite">
      <div className="payment-balance-head"><span>{paymentComplete?<CircleCheck size={20}/>:<CircleDollarSign size={20}/>} {paymentComplete?"Pagamento completo":calculation.remaining<0?"Valor acima do total":"Saldo restante"}</span><strong>{brl(Math.abs(calculation.remaining))}</strong></div>
      <div className="payment-progress" aria-hidden="true"><span style={{width:`${calculation.progress}%`}}/></div>
      <div className="payment-balance-details"><span>Total da conta <strong>{brl(calculation.total)}</strong></span><span>Total informado <strong>{brl(calculation.paid)}</strong></span></div>
      <small>{paymentComplete?"O fechamento e a impressão da notinha estão liberados.":calculation.remaining<0?`Retire ${brl(Math.abs(calculation.remaining))} de um dos pagamentos.`:calculation.people===1?"Selecione a forma de pagamento para completar o valor automaticamente.":"O saldo diminui conforme os pagamentos das pessoas são informados."}</small>
    </section>
    <div className="form-grid">
      <div className="field"><label>Formato da notinha</label><select className="select" name="format" defaultValue="80"><option value="80">Térmica 80 mm</option><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
    </div>
    <button className="btn btn-primary" type="submit" disabled={!paymentComplete}><Printer size={16}/> Finalizar e abrir notinha</button>
  </PrintActionForm>;
}
