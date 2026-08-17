"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDollarSign, CirclePlus, CreditCard, Printer, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { closeCommandAction, quickSaleAction } from "@/app/system-actions";
import { PrintActionForm } from "@/components/print-action-form";

function toCents(value:string){const n=Number(value||0);return Number.isFinite(n)?Math.round(n*100):0;}
function brl(cents:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);}
function centsInput(cents:number){return(cents/100).toFixed(2);}
function digits(value:string){return value.replace(/\D/g,"");}
function formatCpf(value:string){return digits(value).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4");}
function searchText(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");}

type PaymentMethod="CASH"|"PIX"|"DEBIT"|"CREDIT"|"STAFF_VOUCHER"|"STORE_CREDIT";
type PaymentMode="SINGLE"|"MIXED";
type SplitPayment={method:PaymentMethod|"";amount:string;staffMemberId:string};
type PaymentAllocation={method:PaymentMethod;amountCents:number;staffMemberId?:number;customerId?:number};
export type StaffMemberOption={id:number;name:string;position:string|null};
export type CustomerOption={id:number;name:string;cpf:string;contact:string;balanceCents:number};

const basePaymentMethods:Array<{value:Exclude<PaymentMethod,"STORE_CREDIT">;label:string}>=[
  {value:"PIX",label:"PIX"},
  {value:"CASH",label:"Dinheiro"},
  {value:"CREDIT",label:"Cartão de crédito"},
  {value:"DEBIT",label:"Cartão de débito"},
  {value:"STAFF_VOUCHER",label:"Vale funcionário"},
];
function emptyPayment():SplitPayment{return{method:"",amount:"",staffMemberId:""};}

export function PaymentForm({commandId,subtotal,staffMembers,customers,mode="COMMAND",quickSaleItems="[]",onSuccess,canSubmit=true}:{commandId?:number;subtotal:number;staffMembers:StaffMemberOption[];customers:CustomerOption[];mode?:"COMMAND"|"QUICK_SALE";quickSaleItems?:string;onSuccess?:()=>void;canSubmit?:boolean}){
  const [discount,setDiscount]=useState("0");
  const [service,setService]=useState("0");
  const [paymentMode,setPaymentMode]=useState<PaymentMode>("SINGLE");
  const [splitCount,setSplitCount]=useState("1");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod|"">("");
  const [staffMemberId,setStaffMemberId]=useState("");
  const [splitPayments,setSplitPayments]=useState<SplitPayment[]>(()=>[emptyPayment(),emptyPayment()]);
  const [customerSearch,setCustomerSearch]=useState("");
  const [selectedCustomerId,setSelectedCustomerId]=useState("");
  const [customerResultsOpen,setCustomerResultsOpen]=useState(false);
  const [newCustomerOpen,setNewCustomerOpen]=useState(false);
  const [newCustomerName,setNewCustomerName]=useState("");
  const [newCustomerCpf,setNewCustomerCpf]=useState("");
  const [newCustomerContact,setNewCustomerContact]=useState("");
  const [storeCreditAmount,setStoreCreditAmount]=useState("");
  const [remainderMethod,setRemainderMethod]=useState<Exclude<PaymentMethod,"STORE_CREDIT">|"">("");
  const [remainderStaffMemberId,setRemainderStaffMemberId]=useState("");

  const selectedCustomer=useMemo(()=>customers.find((customer)=>String(customer.id)===selectedCustomerId)??null,[customers,selectedCustomerId]);
  const customerMatches=useMemo(()=>{
    const term=customerSearch.trim();
    if(term.length<2)return[];
    const normalized=searchText(term);const cpfDigits=digits(term);
    return customers.filter((customer)=>searchText(customer.name).includes(normalized)||(cpfDigits.length>0&&customer.cpf.includes(cpfDigits))).slice(0,6);
  },[customerSearch,customers]);
  const customerCredit=selectedCustomer;
  const availableBasePaymentMethods=basePaymentMethods;
  const paymentMethods=useMemo(()=>customerCredit&&customerCredit.balanceCents>0?[...availableBasePaymentMethods,{value:"STORE_CREDIT" as const,label:`Crédito em loja — ${brl(customerCredit.balanceCents)}`}]:availableBasePaymentMethods,[availableBasePaymentMethods,customerCredit]);
  const calculation=useMemo(()=>{
    const discountCents=Math.min(toCents(discount),subtotal);
    const serviceCents=Math.round((subtotal-discountCents)*Math.max(0,Number(service)||0)/100);
    const total=subtotal-discountCents+serviceCents;
    const people=paymentMode==="MIXED"?1:Math.min(50,Math.max(1,Math.trunc(Number(splitCount)||1)));
    const usesPaymentRows=paymentMode==="MIXED"||people>1;
    const paymentRowCount=paymentMode==="MIXED"?splitPayments.length:people;
    const allocations:PaymentAllocation[]=[];
    if(!usesPaymentRows&&paymentMethod){
      if(paymentMethod==="STORE_CREDIT"){
        const creditAmount=Math.min(total,toCents(storeCreditAmount));
        if(creditAmount>0&&customerCredit) allocations.push({method:"STORE_CREDIT",amountCents:creditAmount,customerId:customerCredit.id});
        const remainder=Math.max(0,total-creditAmount);
        if(remainder>0&&remainderMethod) allocations.push({method:remainderMethod,amountCents:remainder,staffMemberId:remainderMethod==="STAFF_VOUCHER"?Number(remainderStaffMemberId):undefined});
      }else allocations.push({method:paymentMethod,amountCents:total,staffMemberId:paymentMethod==="STAFF_VOUCHER"?Number(staffMemberId):undefined});
    }
    if(usesPaymentRows){
      for(const payment of splitPayments.slice(0,paymentRowCount)){
        const amountCents=toCents(payment.amount);
        if(payment.method&&amountCents>0) allocations.push({method:payment.method,amountCents,staffMemberId:payment.method==="STAFF_VOUCHER"?Number(payment.staffMemberId):undefined,customerId:payment.method==="STORE_CREDIT"?customerCredit?.id:undefined});
      }
    }
    const paid=allocations.reduce((sum,payment)=>sum+payment.amountCents,0);
    const storeCreditUsed=allocations.filter((payment)=>payment.method==="STORE_CREDIT").reduce((sum,payment)=>sum+payment.amountCents,0);
    const remaining=total-paid;
    const progress=total>0?Math.min(100,Math.max(0,(paid/total)*100)):0;
    return{discountCents,serviceCents,total,paid,people,usesPaymentRows,paymentRowCount,perPerson:Math.round(total/people),remaining,progress,allocations,storeCreditUsed};
  },[customerCredit,discount,paymentMethod,paymentMode,remainderMethod,remainderStaffMemberId,service,splitCount,splitPayments,staffMemberId,storeCreditAmount,subtotal]);

  const splitRowsComplete=!calculation.usesPaymentRows||Array.from({length:calculation.paymentRowCount},(_,index)=>splitPayments[index]).every((payment)=>Boolean(payment?.method)&&toCents(payment?.amount||"")>0);
  const referencesComplete=calculation.allocations.every((payment)=>payment.method!=="STAFF_VOUCHER"||Boolean(payment.staffMemberId&&staffMembers.some((staff)=>Number(staff.id)===payment.staffMemberId)));
  const storeCreditValid=calculation.storeCreditUsed===0||Boolean(customerCredit&&calculation.storeCreditUsed<=customerCredit.balanceCents);
  const selectedStoreCredit=Math.min(calculation.total,toCents(storeCreditAmount));
  const storeCreditRemainder=Math.max(0,calculation.total-selectedStoreCredit);
  const storeCreditSelectionComplete=paymentMethod!=="STORE_CREDIT"||selectedStoreCredit>0;
  const paymentComplete=calculation.total>0&&calculation.remaining===0&&calculation.allocations.length>0&&splitRowsComplete&&referencesComplete&&storeCreditValid&&storeCreditSelectionComplete;
  const newCustomerComplete=newCustomerName.trim().length>=2&&digits(newCustomerCpf).length===11&&newCustomerContact.trim().length>=5;
  const customerIdentificationValid=newCustomerOpen?newCustomerComplete:Boolean(selectedCustomer)||customerSearch.trim()==="";

  function updateSplitPayment(index:number,patch:Partial<SplitPayment>){
    setSplitPayments((current)=>{const next=Array.from({length:Math.max(current.length,index+1)},(_,rowIndex)=>current[rowIndex]||{method:"",amount:"",staffMemberId:""});next[index]={...next[index],...patch};return next;});
  }
  function changePaymentMode(nextMode:PaymentMode){
    if(nextMode===paymentMode)return;
    setPaymentMode(nextMode);setPaymentMethod("");setStaffMemberId("");setStoreCreditAmount("");setRemainderMethod("");setRemainderStaffMemberId("");
    setSplitPayments([emptyPayment(),emptyPayment()]);
    if(nextMode==="MIXED")setSplitCount("1");
  }
  function addMixedPayment(){setSplitPayments((current)=>current.length>=10?current:[...current,emptyPayment()]);}
  function removeMixedPayment(index:number){setSplitPayments((current)=>current.length<=2?current:current.filter((_,rowIndex)=>rowIndex!==index));}
  function remainingForPayment(index:number){
    const otherPayments=splitPayments.reduce((sum,payment,rowIndex)=>rowIndex===index?sum:sum+toCents(payment.amount),0);
    return Math.max(0,calculation.total-otherPayments);
  }
  function fillRemainingPayment(index:number){updateSplitPayment(index,{amount:centsInput(remainingForPayment(index))});}

  function clearCustomerSelection(){
    setSelectedCustomerId("");setCustomerSearch("");setCustomerResultsOpen(false);
    setPaymentMethod((current)=>current==="STORE_CREDIT"?"":current);
    setSplitPayments((current)=>current.map((payment)=>payment.method==="STORE_CREDIT"?{...payment,method:"",amount:""}:payment));
    setStoreCreditAmount("");setRemainderMethod("");setRemainderStaffMemberId("");
  }
  function selectCustomer(customer:CustomerOption){
    setSelectedCustomerId(String(customer.id));setCustomerSearch(customer.name);setCustomerResultsOpen(false);setNewCustomerOpen(false);
    setPaymentMethod((current)=>current==="STORE_CREDIT"?"":current);
    setSplitPayments((current)=>current.map((payment)=>payment.method==="STORE_CREDIT"?{...payment,method:"",amount:""}:payment));
    setStoreCreditAmount("");setRemainderMethod("");setRemainderStaffMemberId("");
  }
  function toggleNewCustomer(){
    if(newCustomerOpen){setNewCustomerOpen(false);return;}
    const typedDigits=digits(customerSearch);
    setSelectedCustomerId("");setNewCustomerOpen(true);setCustomerResultsOpen(false);
    setNewCustomerName(typedDigits.length>0?"":customerSearch.trim());setNewCustomerCpf(typedDigits);setNewCustomerContact("");
    setPaymentMethod((current)=>current==="STORE_CREDIT"?"":current);
    setSplitPayments((current)=>current.map((payment)=>payment.method==="STORE_CREDIT"?{...payment,method:"",amount:""}:payment));
    setStoreCreditAmount("");setRemainderMethod("");setRemainderStaffMemberId("");
  }

  return <PrintActionForm action={mode==="QUICK_SALE"?quickSaleAction:closeCommandAction} className="form-stack" onSuccess={onSuccess}>
    {mode==="COMMAND"?<input type="hidden" name="commandId" value={commandId}/>:<input type="hidden" name="quickSaleItems" value={quickSaleItems}/>}<input type="hidden" name="paymentAllocations" value={JSON.stringify(calculation.allocations)}/><input type="hidden" name="splitCount" value={paymentMode==="MIXED"?"1":splitCount}/><input type="hidden" name="customerId" value={selectedCustomerId}/><input type="hidden" name="createCustomer" value={newCustomerOpen?"1":"0"}/>
    <div className="form-grid"><div className="field"><label>Desconto (R$)</label><input className="input" name="discount" type="number" min="0" step="0.01" value={discount} onChange={(event)=>setDiscount(event.target.value)}/></div><div className="field"><label>Taxa de serviço (%) — opcional</label><input className="input" name="servicePercent" type="number" min="0" max="100" step="0.01" value={service} onChange={(event)=>setService(event.target.value)}/></div></div>
    <div className="card payment-summary"><div className="totals"><div className="total-row"><span>Subtotal</span><span>{brl(subtotal)}</span></div>{calculation.discountCents>0&&<div className="total-row"><span>Desconto</span><span>- {brl(calculation.discountCents)}</span></div>}{calculation.serviceCents>0&&<div className="total-row"><span>Taxa</span><span>{brl(calculation.serviceCents)}</span></div>}<div className="total-row grand"><span>Total</span><span>{brl(calculation.total)}</span></div></div></div>
    <section className="card customer-identification"><div className="customer-identification-head"><div><span className="label">IDENTIFICAÇÃO DO CLIENTE — OPCIONAL</span><p>Vincule nome ou CPF para localizar esta venda mais facilmente na manutenção de movimentos.</p></div><button className="btn btn-light btn-small" type="button" onClick={toggleNewCustomer}><UserPlus size={15}/> {newCustomerOpen?"Voltar à busca":"Cadastrar novo"}</button></div>
      {!newCustomerOpen?<div className="customer-search-wrap"><div className="field"><label htmlFor="sale-customer-search">Nome ou CPF</label><div className="customer-search-input"><Search size={16}/><input id="sale-customer-search" className="input" value={customerSearch} onFocus={()=>setCustomerResultsOpen(true)} onChange={(event)=>{setCustomerSearch(event.target.value);setSelectedCustomerId("");setCustomerResultsOpen(true);}} autoComplete="off" placeholder="Digite ao menos 2 caracteres"/>{customerSearch&&<button type="button" onClick={clearCustomerSelection} aria-label="Limpar cliente"><X size={15}/></button>}</div></div>
        {selectedCustomer?<div className="selected-customer"><CircleCheck size={18}/><div><strong>{selectedCustomer.name}</strong><small>CPF {formatCpf(selectedCustomer.cpf)} · {selectedCustomer.contact}</small>{selectedCustomer.balanceCents>0&&<small><CreditCard size={13}/> Crédito disponível: {brl(selectedCustomer.balanceCents)}</small>}</div><button type="button" onClick={clearCustomerSelection} aria-label="Remover cliente"><X size={16}/></button></div>:customerResultsOpen&&customerSearch.trim().length>=2&&<div className="customer-search-results">{customerMatches.length>0?customerMatches.map((customer)=><button type="button" key={customer.id} onClick={()=>selectCustomer(customer)}><span><strong>{customer.name}</strong><small>CPF {formatCpf(customer.cpf)} · {customer.contact}</small></span>{customer.balanceCents>0&&<small>{brl(customer.balanceCents)} em crédito</small>}</button>):<div className="customer-search-empty"><span>Nenhum cadastro encontrado.</span><button type="button" onClick={toggleNewCustomer}>Cadastrar este cliente</button></div>}</div>}
        {!selectedCustomer&&customerSearch.trim()!==""&&<small className="customer-selection-help">Selecione um resultado, cadastre o cliente ou limpe o campo para continuar sem identificação.</small>}</div>:<div className="form-grid customer-quick-create"><div className="field"><label>Nome</label><input className="input" name="newCustomerName" value={newCustomerName} onChange={(event)=>setNewCustomerName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required/></div><div className="field"><label>CPF</label><input className="input" name="newCustomerCpf" value={newCustomerCpf} onChange={(event)=>setNewCustomerCpf(event.target.value)} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" required/></div><div className="field"><label>Contato</label><input className="input" name="newCustomerContact" value={newCustomerContact} onChange={(event)=>setNewCustomerContact(event.target.value)} minLength={5} maxLength={120} autoComplete="tel" placeholder="Telefone ou WhatsApp" required/></div><small className="customer-quick-create-help">O cadastro será criado e vinculado automaticamente ao finalizar. Para não identificar o cliente, volte à busca e deixe o campo vazio.</small></div>}
    </section>
    {staffMembers.length===0&&<div className="alert alert-info">Não há funcionário ativo para vincular a um vale. Solicite o cadastro na aba Funcionários.</div>}

    <p className="label payment-label">FORMAS DE PAGAMENTO</p>
    <section className="card payment-mode-card"><div><strong>Como o cliente vai pagar?</strong><small>Use pagamento misto para combinar PIX, cartões, dinheiro, vale ou crédito em loja.</small></div><div className="payment-mode-options" role="group" aria-label="Tipo de pagamento"><button className={`payment-mode-option ${paymentMode==="SINGLE"?"active":""}`} type="button" aria-pressed={paymentMode==="SINGLE"} onClick={()=>changePaymentMode("SINGLE")}><strong>Normal</strong><small>Uma forma ou divisão por pessoas</small></button><button className={`payment-mode-option ${paymentMode==="MIXED"?"active":""}`} type="button" aria-pressed={paymentMode==="MIXED"} onClick={()=>changePaymentMode("MIXED")}><strong>Pagamento misto</strong><small>Ex.: R$ 10 no PIX + R$ 10 no crédito</small></button></div></section>
    {paymentMode==="SINGLE"&&<div className="split-calculator"><div className="field"><label><Users size={14}/> Dividir entre quantas pessoas?</label><input className="input" type="number" min="1" max="50" step="1" value={splitCount} onChange={(event)=>setSplitCount(event.target.value)}/></div><div><small>Valor por pessoa</small><strong>{brl(calculation.perPerson)}</strong>{calculation.total%calculation.people!==0&&<small>A última parte pode ter ajuste de centavos.</small>}</div></div>}
    {!calculation.usesPaymentRows?<div className="payment-method-selector form-stack"><div className="field"><label>Selecione a forma de pagamento</label><select className="select" value={paymentMethod} onChange={(event)=>{setPaymentMethod(event.target.value as PaymentMethod|"");setStoreCreditAmount("");setRemainderMethod("");setStaffMemberId("");setRemainderStaffMemberId("");}} required><option value="">Selecione</option>{paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div>
      {paymentMethod==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={staffMemberId} onChange={(event)=>setStaffMemberId(event.target.value)} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}
      {paymentMethod==="STORE_CREDIT"&&customerCredit&&<><div className="field"><label>Valor do crédito que será usado (R$)</label><input className="input" type="number" min="0.01" max={centsInput(Math.min(calculation.total,customerCredit.balanceCents))} step="0.01" value={storeCreditAmount} onChange={(event)=>setStoreCreditAmount(event.target.value)} required/><small>Disponível para {customerCredit.name}: <strong>{brl(customerCredit.balanceCents)}</strong></small></div>{storeCreditRemainder>0&&<><div className="field"><label>Forma de pagamento do saldo de {brl(storeCreditRemainder)}</label><select className="select" value={remainderMethod} onChange={(event)=>{setRemainderMethod(event.target.value as Exclude<PaymentMethod,"STORE_CREDIT">|"");setRemainderStaffMemberId("");}} required><option value="">Selecione</option>{availableBasePaymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div>{remainderMethod==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={remainderStaffMemberId} onChange={(event)=>setRemainderStaffMemberId(event.target.value)} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}</>}</>}
      <small>{paymentMethod&&paymentMethod!=="STORE_CREDIT"?`O valor de ${brl(calculation.total)} será lançado automaticamente.`:"Escolha uma opção para lançar o pagamento."}</small></div>:<div className="split-payment-list">{paymentMode==="MIXED"&&<div className="mixed-payment-head"><div><strong>Combine as formas de pagamento</strong><small>Informe cada valor ou use o botão “Usar saldo restante”.</small></div><button className="btn btn-light btn-small" type="button" onClick={addMixedPayment} disabled={splitPayments.length>=10}><CirclePlus size={15}/> Adicionar forma</button></div>}{Array.from({length:calculation.paymentRowCount},(_,index)=>{const payment=splitPayments[index]||emptyPayment();return <div className="split-payment-row" key={index}><div className="payment-row-title"><strong>{paymentMode==="MIXED"?`Pagamento ${index+1}`:`Pessoa ${index+1}`}</strong>{paymentMode==="MIXED"&&<button className="mixed-payment-remove" type="button" onClick={()=>removeMixedPayment(index)} disabled={splitPayments.length<=2} aria-label={`Remover pagamento ${index+1}`} title="Remover forma"><Trash2 size={14}/></button>}</div><div className="field"><label htmlFor={`payment-method-${index}`}>Forma de pagamento</label><select className="select" id={`payment-method-${index}`} value={payment.method} onChange={(event)=>updateSplitPayment(index,{method:event.target.value as PaymentMethod|"",staffMemberId:""})} required><option value="">Selecione</option>{paymentMethods.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div><div className="field"><label htmlFor={`payment-amount-${index}`}>Valor pago (R$)</label><input className="input" id={`payment-amount-${index}`} type="number" min="0.01" step="0.01" placeholder={paymentMode==="MIXED"?"0,00":centsInput(calculation.perPerson)} value={payment.amount} onChange={(event)=>updateSplitPayment(index,{amount:event.target.value})} required/>{paymentMode==="MIXED"&&<button className="mixed-fill-button" type="button" onClick={()=>fillRemainingPayment(index)} disabled={remainingForPayment(index)<=0}>Usar saldo restante</button>}</div>{payment.method==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário responsável pelo vale</label><select className="select" value={payment.staffMemberId} onChange={(event)=>updateSplitPayment(index,{staffMemberId:event.target.value})} required><option value="">Selecione o funcionário</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}</div>;})}<small className="split-payment-help">{paymentMode==="MIXED"?"Você pode combinar até 10 formas. A soma precisa ser igual ao total da conta.":"Informe como cada pessoa pagou. O sistema registra cada lançamento separadamente."}</small></div>}
    {calculation.storeCreditUsed>(customerCredit?.balanceCents||0)&&<div className="alert alert-error">O crédito em loja informado ultrapassa o saldo disponível.</div>}
    <section className={`payment-balance ${paymentComplete?"payment-balance-complete":calculation.remaining<0?"payment-balance-over":""}`} aria-live="polite"><div className="payment-balance-head"><span>{paymentComplete?<CircleCheck size={20}/>:<CircleDollarSign size={20}/>} {paymentComplete?"Pagamento completo":calculation.remaining<0?"Valor acima do total":"Saldo restante"}</span><strong>{brl(Math.abs(calculation.remaining))}</strong></div><div className="payment-progress" aria-hidden="true"><span style={{width:`${calculation.progress}%`}}/></div><div className="payment-balance-details"><span>Total da conta <strong>{brl(calculation.total)}</strong></span><span>Total informado <strong>{brl(calculation.paid)}</strong></span></div><small>{paymentComplete?"O fechamento e a impressão da notinha estão liberados.":calculation.remaining<0?`Retire ${brl(Math.abs(calculation.remaining))} de um dos pagamentos.`:paymentMode==="MIXED"?"Informe as formas e os valores até completar o saldo.":calculation.people===1?"Selecione a forma de pagamento para completar o valor.":"O saldo diminui conforme os pagamentos são informados."}</small></section>
    <div className="field"><label>Formato da notinha</label><select className="select" name="format" defaultValue="80"><option value="80">Térmica 80 mm</option><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
    <button className="btn btn-primary" type="submit" disabled={!canSubmit||!paymentComplete||!customerIdentificationValid}><Printer size={16}/> {mode==="QUICK_SALE"?"Finalizar venda rápida e abrir notinha":"Finalizar e abrir notinha"}</button>
  </PrintActionForm>;
}
