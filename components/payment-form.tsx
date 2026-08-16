"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDollarSign, CreditCard, Printer, Search, Users } from "lucide-react";
import { closeCommandAction } from "@/app/system-actions";
import { PrintActionForm } from "@/components/print-action-form";

function toCents(value:string){const n=Number(value||0);return Number.isFinite(n)?Math.round(n*100):0;}
function brl(cents:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);}
function centsInput(cents:number){return(cents/100).toFixed(2);}

type PaymentMethod="CASH"|"PIX"|"DEBIT"|"CREDIT"|"STAFF_VOUCHER"|"STORE_CREDIT";
type SplitPayment={method:PaymentMethod|"";amount:string;staffMemberId:string};
type CustomerCredit={id:number;name:string;cpf:string;contact:string;balanceCents:number};
type PaymentAllocation={method:PaymentMethod;amountCents:number;staffMemberId?:number;customerId?:number};
export type StaffMemberOption={id:number;name:string;position:string|null};

const basePaymentMethods:Array<{value:Exclude<PaymentMethod,"STORE_CREDIT">;label:string}>=[
  {value:"PIX",label:"PIX"},
  {value:"CASH",label:"Dinheiro"},
  {value:"CREDIT",label:"Cartão de crédito"},
  {value:"DEBIT",label:"Cartão de débito"},
  {value:"STAFF_VOUCHER",label:"Vale funcionário"},
];

export function PaymentForm({commandId,subtotal,staffMembers}:{commandId:number;subtotal:number;staffMembers:StaffMemberOption[]}){
  const [discount,setDiscount]=useState("0");
  const [service,setService]=useState("0");
  const [splitCount,setSplitCount]=useState("1");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod|"">("");
  const [staffMemberId,setStaffMemberId]=useState("");
  const [splitPayments,setSplitPayments]=useState<SplitPayment[]>([]);
  const [creditLookupOpen,setCreditLookupOpen]=useState(false);
  const [creditCpf,setCreditCpf]=useState("");
  const [creditLookupMessage,setCreditLookupMessage]=useState("");
  const [creditLookupPending,setCreditLookupPending]=useState(false);
  const [customerCredit,setCustomerCredit]=useState<CustomerCredit|null>(null);
  const [storeCreditAmount,setStoreCreditAmount]=useState("");
  const [remainderMethod,setRemainderMethod]=useState<Exclude<PaymentMethod,"STORE_CREDIT">|"">("");
  const [remainderStaffMemberId,setRemainderStaffMemberId]=useState("");

  const availableBasePaymentMethods=useMemo(()=>staffMembers.length>0?basePaymentMethods:basePaymentMethods.filter((method)=>method.value!=="STAFF_VOUCHER"),[staffMembers]);
  const paymentMethods=useMemo(()=>customerCredit&&customerCredit.balanceCents>0?[...availableBasePaymentMethods,{value:"STORE_CREDIT" as const,label:`Crédito em loja — ${brl(customerCredit.balanceCents)}`}]:availableBasePaymentMethods,[availableBasePaymentMethods,customerCredit]);
  const calculation=useMemo(()=>{
    const discountCents=Math.min(toCents(discount),subtotal);
    const serviceCents=Math.round((subtotal-discountCents)*Math.max(0,Number(service)||0)/100);
    const total=subtotal-discountCents+serviceCents;
    const people=Math.min(50,Math.max(1,Math.trunc(Number(splitCount)||1)));
    const allocations:PaymentAllocation[]=[];
    if(people===1&&paymentMethod){
      if(paymentMethod==="STORE_CREDIT"){
        const creditAmount=Math.min(total,toCents(storeCreditAmount));
        if(creditAmount>0&&customerCredit) allocations.push({method:"STORE_CREDIT",amountCents:creditAmount,customerId:customerCredit.id});
        const remainder=Math.max(0,total-creditAmount);
        if(remainder>0&&remainderMethod) allocations.push({method:remainderMethod,amountCents:remainder,staffMemberId:remainderMethod==="STAFF_VOUCHER"?Number(remainderStaffMemberId):undefined});
      }else allocations.push({method:paymentMethod,amountCents:total,staffMemberId:paymentMethod==="STAFF_VOUCHER"?Number(staffMemberId):undefined});
    }
    if(people>1){
      for(const payment of splitPayments.slice(0,people)){
        const amountCents=toCents(payment.amount);
        if(payment.method&&amountCents>0) allocations.push({method:payment.method,amountCents,staffMemberId:payment.method==="STAFF_VOUCHER"?Number(payment.staffMemberId):undefined,customerId:payment.method==="STORE_CREDIT"?customerCredit?.id:undefined});
      }
    }
    const paid=allocations.reduce((sum,payment)=>sum+payment.amountCents,0);
    const storeCreditUsed=allocations.filter((payment)=>payment.method==="STORE_CREDIT").reduce((sum,payment)=>sum+payment.amountCents,0);
    const remaining=total-paid;
    const progress=total>0?Math.min(100,Math.max(0,(paid/total)*100)):0;
    return{discountCents,serviceCents,total,paid,people,perPerson:Math.round(total/people),remaining,progress,allocations,storeCreditUsed};
  },[customerCredit,discount,paymentMethod,remainderMethod,remainderStaffMemberId,service,splitCount,splitPayments,staffMemberId,storeCreditAmount,subtotal]);

  const splitRowsComplete=calculation.people===1||Array.from({length:calculation.people},(_,index)=>splitPayments[index]).every((payment)=>Boolean(payment?.method)&&toCents(payment?.amount||"")>0);
  const referencesComplete=calculation.allocations.every((payment)=>payment.method!=="STAFF_VOUCHER"||Boolean(payment.staffMemberId&&staffMembers.some((staff)=>Number(staff.id)===payment.staffMemberId)));
  const storeCreditValid=calculation.storeCreditUsed===0||Boolean(customerCredit&&calculation.storeCreditUsed<=customerCredit.balanceCents);
  const selectedStoreCredit=Math.min(calculation.total,toCents(storeCreditAmount));
  const storeCreditRemainder=Math.max(0,calculation.total-selectedStoreCredit);
  const storeCreditSelectionComplete=paymentMethod!=="STORE_CREDIT"||selectedStoreCredit>0;
  const paymentComplete=calculation.total>0&&calculation.remaining===0&&calculation.allocations.length>0&&splitRowsComplete&&referencesComplete&&storeCreditValid&&storeCreditSelectionComplete;

  function updateSplitPayment(index:number,patch:Partial<SplitPayment>){
    setSplitPayments((current)=>{const next=Array.from({length:Math.max(current.length,index+1)},(_,rowIndex)=>current[rowIndex]||{method:"",amount:"",staffMemberId:""});next[index]={...next[index],...patch};return next;});
  }

  async function lookupCustomerCredit(){
    const cpf=creditCpf.replace(/\D/g,"");
    if(cpf.length!==11){setCreditLookupMessage("Informe os 11 números do CPF.");setCustomerCredit(null);return;}
    setCreditLookupPending(true);setCreditLookupMessage("");setCustomerCredit(null);
    try{
      const response=await fetch(`/api/customers/credit?cpf=${encodeURIComponent(cpf)}`,{cache:"no-store"});
      const data=await response.json() as {customer?:CustomerCredit;error?:string};
      if(!response.ok||!data.customer){setCreditLookupMessage(data.error||"Cliente não encontrado.");return;}
      setCustomerCredit(data.customer);setCreditLookupMessage(data.customer.balanceCents>0?`Crédito localizado: ${brl(data.customer.balanceCents)}.`:"Cliente localizado, mas sem crédito disponível.");
    }catch{setCreditLookupMessage("Não foi possível consultar o crédito agora.");}
    finally{setCreditLookupPending(false);}
  }

  return <PrintActionForm action={closeCommandAction} className="form-stack">
    <input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="paymentAllocations" value={JSON.stringify(calculation.allocations)}/>
    <div className="form-grid"><div className="field"><label>Desconto (R$)</label><input className="input" name="discount" type="number" min="0" step="0.01" value={discount} onChange={(event)=>setDiscount(event.target.value)}/></div><div className="field"><label>Taxa de serviço (%) — opcional</label><input className="input" name="servicePercent" type="number" min="0" max="100" step="0.01" value={service} onChange={(event)=>setService(event.target.value)}/></div></div>
    <div className="card payment-summary"><div className="totals"><div className="total-row"><span>Subtotal</span><span>{brl(subtotal)}</span></div>{calculation.discountCents>0&&<div className="total-row"><span>Desconto</span><span>- {brl(calculation.discountCents)}</span></div>}{calculation.serviceCents>0&&<div className="total-row"><span>Taxa</span><span>{brl(calculation.serviceCents)}</span></div>}<div className="total-row grand"><span>Total</span><span>{brl(calculation.total)}</span></div></div></div>
    <div className="split-calculator"><div className="field"><label><Users size={14}/> Dividir entre quantas pessoas?</label><input className="input" name="splitCount" type="number" min="1" max="50" step="1" value={splitCount} onChange={(event)=>setSplitCount(event.target.value)}/></div><div><small>Valor por pessoa</small><strong>{brl(calculation.perPerson)}</strong>{calculation.total%calculation.people!==0&&<small>A última parte pode ter ajuste de centavos.</small>}</div></div>
    <div className="store-credit-lookup"><button className="btn btn-light" type="button" onClick={()=>setCreditLookupOpen((open)=>!open)}><CreditCard size={16}/> Consultar crédito de cliente</button>{creditLookupOpen&&<div className="store-credit-lookup-form"><div className="field"><label>CPF do cliente</label><input className="input" inputMode="numeric" value={creditCpf} onChange={(event)=>{setCreditCpf(event.target.value);setCustomerCredit(null);setCreditLookupMessage("");}} placeholder="000.000.000-00"/></div><button className="btn btn-primary btn-small" type="button" onClick={lookupCustomerCredit} disabled={creditLookupPending}><Search size={15}/> {creditLookupPending?"Consultando...":"Verificar crédito"}</button>{creditLookupMessage&&<span className={customerCredit?"credit-lookup-success":"credit-lookup-error"}>{customerCredit&&<CircleCheck size={15}/>} {creditLookupMessage}{customerCredit&&<> <strong>{customerCredit.name}</strong></>}</span>}</div>}</div>
    {staffMembers.length===0&&<div className="alert alert-info">Não há funcionário ativo para vincular a um vale. Solicite o cadastro na aba Funcionários.</div>}

    <p className="label payment-label">FORMAS DE PAGAMENTO</p>
    {calculation.people===1?<div className="payment-method-selector form-stack"><div className="field"><label>Selecione a forma de pagamento</label><select className="select" value={paymentMethod} onChange={(event)=>{setPaymentMethod(event.target.value as PaymentMethod|"");setStoreCreditAmount("");setRemainderMethod("");setStaffMemberId("");setRemainderStaffMemberId("");}} required><option value="">Selecione</option>{paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div>
      {paymentMethod==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={staffMemberId} onChange={(event)=>setStaffMemberId(event.target.value)} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}
      {paymentMethod==="STORE_CREDIT"&&customerCredit&&<><div className="field"><label>Valor do crédito que será usado (R$)</label><input className="input" type="number" min="0.01" max={centsInput(Math.min(calculation.total,customerCredit.balanceCents))} step="0.01" value={storeCreditAmount} onChange={(event)=>setStoreCreditAmount(event.target.value)} required/><small>Disponível para {customerCredit.name}: <strong>{brl(customerCredit.balanceCents)}</strong></small></div>{storeCreditRemainder>0&&<><div className="field"><label>Forma de pagamento do saldo de {brl(storeCreditRemainder)}</label><select className="select" value={remainderMethod} onChange={(event)=>{setRemainderMethod(event.target.value as Exclude<PaymentMethod,"STORE_CREDIT">|"");setRemainderStaffMemberId("");}} required><option value="">Selecione</option>{availableBasePaymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div>{remainderMethod==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={remainderStaffMemberId} onChange={(event)=>setRemainderStaffMemberId(event.target.value)} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}</>}</>}
      <small>{paymentMethod&&paymentMethod!=="STORE_CREDIT"?`O valor de ${brl(calculation.total)} será lançado automaticamente.`:"Escolha uma opção para lançar o pagamento."}</small></div>:<div className="split-payment-list">{Array.from({length:calculation.people},(_,index)=>{const payment=splitPayments[index]||{method:"",amount:"",staffMemberId:""};return <div className="split-payment-row" key={index}><strong>Pessoa {index+1}</strong><div className="field"><label htmlFor={`payment-method-${index}`}>Forma de pagamento</label><select className="select" id={`payment-method-${index}`} value={payment.method} onChange={(event)=>updateSplitPayment(index,{method:event.target.value as PaymentMethod|"",staffMemberId:""})} required><option value="">Selecione</option>{paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div><div className="field"><label htmlFor={`payment-amount-${index}`}>Valor pago (R$)</label><input className="input" id={`payment-amount-${index}`} type="number" min="0.01" step="0.01" placeholder={centsInput(calculation.perPerson)} value={payment.amount} onChange={(event)=>updateSplitPayment(index,{amount:event.target.value})} required/></div>{payment.method==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={payment.staffMemberId} onChange={(event)=>updateSplitPayment(index,{staffMemberId:event.target.value})} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}</div>;})}<small className="split-payment-help">Informe como cada pessoa pagou. O sistema registra cada lançamento separadamente.</small></div>}
    {calculation.storeCreditUsed>(customerCredit?.balanceCents||0)&&<div className="alert alert-error">O crédito em loja informado ultrapassa o saldo disponível.</div>}
    <section className={`payment-balance ${paymentComplete?"payment-balance-complete":calculation.remaining<0?"payment-balance-over":""}`} aria-live="polite"><div className="payment-balance-head"><span>{paymentComplete?<CircleCheck size={20}/>:<CircleDollarSign size={20}/>} {paymentComplete?"Pagamento completo":calculation.remaining<0?"Valor acima do total":"Saldo restante"}</span><strong>{brl(Math.abs(calculation.remaining))}</strong></div><div className="payment-progress" aria-hidden="true"><span style={{width:`${calculation.progress}%`}}/></div><div className="payment-balance-details"><span>Total da conta <strong>{brl(calculation.total)}</strong></span><span>Total informado <strong>{brl(calculation.paid)}</strong></span></div><small>{paymentComplete?"O fechamento e a impressão da notinha estão liberados.":calculation.remaining<0?`Retire ${brl(Math.abs(calculation.remaining))} de um dos pagamentos.`:calculation.people===1?"Selecione a forma de pagamento para completar o valor.":"O saldo diminui conforme os pagamentos são informados."}</small></section>
    <div className="field"><label>Formato da notinha</label><select className="select" name="format" defaultValue="80"><option value="80">Térmica 80 mm</option><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
    <button className="btn btn-primary" type="submit" disabled={!paymentComplete}><Printer size={16}/> Finalizar e abrir notinha</button>
  </PrintActionForm>;
}
