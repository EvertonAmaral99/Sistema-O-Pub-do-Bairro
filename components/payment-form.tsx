"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDollarSign, Printer, Users } from "lucide-react";
import { closeCommandAction } from "@/app/system-actions";
import { PrintActionForm } from "@/components/print-action-form";

function toCents(value: string) { const n=Number(value||0); return Number.isFinite(n)?Math.round(n*100):0; }
function brl(cents:number){ return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100); }

export function PaymentForm({commandId,subtotal}:{commandId:number;subtotal:number}){
  const [discount,setDiscount]=useState("0");
  const [service,setService]=useState("0");
  const [splitCount,setSplitCount]=useState("1");
  const [cash,setCash]=useState("0");
  const [pix,setPix]=useState("0");
  const [debit,setDebit]=useState("0");
  const [credit,setCredit]=useState("0");
  const [staffVoucher,setStaffVoucher]=useState("0");
  const calculation=useMemo(()=>{
    const discountCents=Math.min(toCents(discount),subtotal);
    const serviceCents=Math.round((subtotal-discountCents)*Math.max(0,Number(service)||0)/100);
    const total=subtotal-discountCents+serviceCents;
    const paid=[cash,pix,debit,credit,staffVoucher].reduce((sum,value)=>sum+toCents(value),0);
    const people=Math.max(1,Math.trunc(Number(splitCount)||1));
    const remaining=total-paid;
    const progress=total>0?Math.min(100,Math.max(0,(paid/total)*100)):0;
    return{discountCents,serviceCents,total,paid,people,perPerson:Math.round(total/people),remaining,progress};
  },[discount,service,cash,pix,debit,credit,staffVoucher,splitCount,subtotal]);
  const paymentComplete=calculation.total>0&&calculation.remaining===0;

  return <PrintActionForm action={closeCommandAction} className="form-stack">
    <input type="hidden" name="commandId" value={commandId}/>
    <div className="form-grid"><div className="field"><label>Desconto (R$)</label><input className="input" name="discount" type="number" min="0" step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)}/></div><div className="field"><label>Taxa de serviço (%) — opcional</label><input className="input" name="servicePercent" type="number" min="0" max="100" step="0.01" value={service} onChange={e=>setService(e.target.value)}/></div></div>
    <div className="card payment-summary"><div className="totals"><div className="total-row"><span>Subtotal</span><span>{brl(subtotal)}</span></div>{calculation.discountCents>0&&<div className="total-row"><span>Desconto</span><span>- {brl(calculation.discountCents)}</span></div>}{calculation.serviceCents>0&&<div className="total-row"><span>Taxa</span><span>{brl(calculation.serviceCents)}</span></div>}<div className="total-row grand"><span>Total</span><span>{brl(calculation.total)}</span></div></div></div>

    <div className="split-calculator"><div className="field"><label><Users size={14}/> Dividir entre quantas pessoas?</label><input className="input" name="splitCount" type="number" min="1" step="1" value={splitCount} onChange={e=>setSplitCount(e.target.value)}/></div><div><small>Valor por pessoa</small><strong>{brl(calculation.perPerson)}</strong>{calculation.total%calculation.people!==0&&<small>A última parte pode ter ajuste de centavos.</small>}</div></div>

    <p className="label payment-label">FORMAS DE PAGAMENTO</p>
    <section className={`payment-balance ${paymentComplete?"payment-balance-complete":calculation.remaining<0?"payment-balance-over":""}`} aria-live="polite">
      <div className="payment-balance-head"><span>{paymentComplete?<CircleCheck size={20}/>:<CircleDollarSign size={20}/>} {paymentComplete?"Pagamento completo":calculation.remaining<0?"Valor acima do total":"Saldo restante"}</span><strong>{brl(Math.abs(calculation.remaining))}</strong></div>
      <div className="payment-progress" aria-hidden="true"><span style={{width:`${calculation.progress}%`}}/></div>
      <div className="payment-balance-details"><span>Total da conta <strong>{brl(calculation.total)}</strong></span><span>Total informado <strong>{brl(calculation.paid)}</strong></span></div>
      <small>{paymentComplete?"O fechamento e a impressão da notinha estão liberados.":calculation.remaining<0?`Retire ${brl(Math.abs(calculation.remaining))} de uma das formas de pagamento.`:"O saldo diminui conforme os valores são distribuídos entre as formas de pagamento."}</small>
    </section>
    <div className="form-grid">
      <div className="field"><label>Pix (R$)</label><input className="input" name="pix" type="number" min="0" step="0.01" value={pix} onChange={e=>setPix(e.target.value)}/></div>
      <div className="field"><label>Dinheiro (R$)</label><input className="input" name="cash" type="number" min="0" step="0.01" value={cash} onChange={e=>setCash(e.target.value)}/></div>
      <div className="field"><label>Cartão de crédito (R$)</label><input className="input" name="credit" type="number" min="0" step="0.01" value={credit} onChange={e=>setCredit(e.target.value)}/></div>
      <div className="field"><label>Cartão de débito (R$)</label><input className="input" name="debit" type="number" min="0" step="0.01" value={debit} onChange={e=>setDebit(e.target.value)}/></div>
      <div className="field"><label>Vale funcionário (R$)</label><input className="input" name="staffVoucher" type="number" min="0" step="0.01" value={staffVoucher} onChange={e=>setStaffVoucher(e.target.value)}/></div>
      <div className="field"><label>Formato da notinha</label><select className="select" name="format" defaultValue="80"><option value="80">Térmica 80 mm</option><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
    </div>
    <button className="btn btn-primary" type="submit" disabled={!paymentComplete}><Printer size={16}/> Finalizar e abrir notinha</button>
  </PrintActionForm>;
}
