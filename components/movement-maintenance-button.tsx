"use client";

import { useRef, useState, useTransition } from "react";
import { Ban, CirclePlus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { cancelSaleAction, updateSaleMovementAction } from "@/app/system-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "@/lib/payments";

type CustomerOption={id:number;name:string;cpf:string;store_credit_balance_cents:number;active:boolean};
type StaffOption={id:number;name:string;position:string|null};
type EditablePayment={key:string;method:PaymentMethod;amount:string;staffMemberId:string};
type SaleDetails={
  sale:{id:number;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string;customer_id:number|null;customer_name:string|null;customer_cpf:string|null;subtotal_cents:number;discount_cents:number;service_fee_cents:number;total_cents:number;status:string;created_at:string;user_name:string};
  items:Array<{id:number;product_name:string;quantity:string;unit_price_cents:number;display_unit:string}>;
  payments:Array<{id:number;method:PaymentMethod;amount_cents:number;staff_member_id:number|null;staff_member_name:string|null;staff_voucher_status:string|null;customer_id:number|null;customer_name:string|null}>;
};

const methodOptions=PAYMENT_METHOD_OPTIONS;
const units:Record<string,string>={UNIT:"un.",KG:"kg",L:"L",PORTION:"porção",DOSE:"dose",BOTTLE:"garrafa",CAN:"lata"};
function money(cents:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);}
function toCents(value:string){const parsed=Number(value.replace(",","."));return Number.isFinite(parsed)?Math.max(0,Math.round(parsed*100)):0;}
function formatCpf(value:string){return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4");}
function paymentRow(method:PaymentMethod="PIX"):EditablePayment{return{key:`${Date.now()}-${Math.random()}`,method,amount:"",staffMemberId:""};}

export function MovementMaintenanceButton({saleId,customers,staffMembers}:{saleId:number;customers:CustomerOption[];staffMembers:StaffOption[]}){
  const dialogRef=useRef<HTMLDialogElement>(null);
  const router=useRouter();
  const [details,setDetails]=useState<SaleDetails|null>(null);
  const [customerId,setCustomerId]=useState("");
  const [payments,setPayments]=useState<EditablePayment[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [saving,startSaving]=useTransition();

  async function fetchDetails(){
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/sales/${saleId}?movement=${Date.now()}`,{cache:"no-store"});
      const data=await response.json() as SaleDetails&{error?:string};
      if(!response.ok){setError(data.error||"Não foi possível abrir a venda.");return;}
      setDetails(data);
      setCustomerId(data.sale.customer_id?String(data.sale.customer_id):"");
      setPayments(data.payments.map((payment)=>({key:String(payment.id),method:payment.method,amount:(Number(payment.amount_cents)/100).toFixed(2),staffMemberId:payment.staff_member_id?String(payment.staff_member_id):""})));
    }catch{setError("Não foi possível abrir a venda.");}
    finally{setLoading(false);}
  }
  function open(){dialogRef.current?.showModal();setSuccess("");if(!details&&!loading)void fetchDetails();}
  function updatePayment(key:string,patch:Partial<EditablePayment>){setPayments((current)=>current.map((payment)=>payment.key===key?{...payment,...patch}:payment));}
  const informedTotal=payments.reduce((sum,payment)=>sum+toCents(payment.amount),0);
  const rowsComplete=payments.length>0&&payments.every((payment)=>toCents(payment.amount)>0&&(payment.method!=="STAFF_VOUCHER"||Boolean(payment.staffMemberId))&&(payment.method!=="STORE_CREDIT"||Boolean(customerId)));
  const totalMatches=Boolean(details&&informedTotal===Number(details.sale.total_cents));
  const settledVoucher=Boolean(details?.payments.some((payment)=>payment.method==="STAFF_VOUCHER"&&payment.staff_voucher_status==="SETTLED"));
  const canEdit=Boolean(details&&details.sale.status==="COMPLETED"&&!settledVoucher);
  const canSave=Boolean(canEdit&&rowsComplete&&totalMatches);

  function save(){
    if(!canSave)return;
    startSaving(async()=>{
      setError("");setSuccess("");
      const allocations=payments.map((payment)=>({method:payment.method,amountCents:toCents(payment.amount),staffMemberId:payment.method==="STAFF_VOUCHER"?Number(payment.staffMemberId):undefined,customerId:payment.method==="STORE_CREDIT"?Number(customerId):undefined}));
      const formData=new FormData();formData.set("saleId",String(saleId));formData.set("customerId",customerId);formData.set("paymentAllocations",JSON.stringify(allocations));
      const result=await updateSaleMovementAction(formData);
      if(result.error){setError(result.error);return;}
      setSuccess("Movimento atualizado e registrado no histórico.");
      await fetchDetails();router.refresh();
    });
  }

  return <><button className="sale-number-button" type="button" onClick={open}>Pedido #{saleId}</button><dialog className="sale-details-dialog movement-maintenance-dialog" ref={dialogRef}><div className="sale-details-head"><div><span className="eyebrow">Manutenção de movimento</span><h3>Pedido #{saleId}</h3>{details&&<p>{new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(details.sale.created_at))} · {details.sale.user_name}</p>}</div><form method="dialog"><button className="priority-dialog-close" type="submit" aria-label="Fechar"><X size={19}/></button></form></div>
    {loading&&<div className="empty">Carregando movimento...</div>}{error&&<div className="alert alert-error">{error}</div>}{success&&<div className="alert alert-success">{success}</div>}
    {details&&<div className="sale-details-content movement-maintenance-content"><div className="sale-details-meta"><span><small>Origem</small><strong>{details.sale.sale_channel==="QUICK_SALE"?"Venda rápida":details.sale.command_name||`Comanda #${details.sale.command_number}`}</strong></span><span><small>{details.sale.sale_channel==="QUICK_SALE"?"Atendimento":"Mesa(s)"}</small><strong>{details.sale.sale_channel==="QUICK_SALE"?"Balcão / caixa":details.sale.table_display}</strong></span><span><small>Total da venda</small><strong>{money(details.sale.total_cents)}</strong></span><span><small>Situação</small><strong>{details.sale.status==="COMPLETED"?"Concluída":"Cancelada"}</strong></span></div>
      <section><h4>Produtos da venda</h4><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>{details.items.map((item)=><tr key={item.id}><td>{item.product_name}</td><td>{new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(Number(item.quantity))} {units[item.display_unit]||item.display_unit}</td><td className="money">{money(Math.round(Number(item.quantity)*Number(item.unit_price_cents)))}</td></tr>)}</tbody></table></div></section>
      {!canEdit&&<div className="alert alert-info">{details.sale.status!=="COMPLETED"?"Esta venda foi cancelada. Os produtos comprados permanecem registrados para consulta, mesmo após a devolução do saldo ao estoque.":"Existe um vale já quitado nesta venda. A edição fica bloqueada para preservar a baixa realizada."}</div>}
      <section className="card movement-edit-section"><h4>Cliente vinculado</h4><div className="field"><label>Cliente cadastrado</label><select className="select" value={customerId} onChange={(event)=>setCustomerId(event.target.value)} disabled={!canEdit}><option value="">Sem cliente vinculado</option>{customers.map((customer)=><option value={customer.id} key={customer.id} disabled={!customer.active}>{customer.name} · CPF {formatCpf(customer.cpf)}{!customer.active?" · inativo":""}</option>)}</select><small>O CPF e o nome usados na busca serão os do cadastro selecionado.</small></div></section>
      <section className="card movement-edit-section"><div className="page-head"><div><h4>Formas de pagamento</h4><p>Altere, remova ou adicione lançamentos. A soma deve continuar igual ao total da venda.</p></div><button className="btn btn-light btn-small" type="button" onClick={()=>setPayments((current)=>[...current,paymentRow()])} disabled={!canEdit}><CirclePlus size={15}/> Adicionar forma</button></div>
        <div className="movement-payment-list">{payments.map((payment,index)=><div className="movement-payment-row" key={payment.key}><strong>Pagamento {index+1}</strong><div className="field"><label>Forma</label><select className="select" value={payment.method} onChange={(event)=>updatePayment(payment.key,{method:event.target.value as PaymentMethod,staffMemberId:""})} disabled={!canEdit}>{methodOptions.map((method)=><option value={method.value} key={method.value}>{method.label}</option>)}</select></div><div className="field"><label>Valor (R$)</label><input className="input" type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event)=>updatePayment(payment.key,{amount:event.target.value})} disabled={!canEdit}/></div>{payment.method==="STAFF_VOUCHER"&&<div className="field"><label>Funcionário</label><select className="select" value={payment.staffMemberId} onChange={(event)=>updatePayment(payment.key,{staffMemberId:event.target.value})} disabled={!canEdit}><option value="">Selecione</option>{staffMembers.map((staff)=><option value={staff.id} key={staff.id}>{staff.name}{staff.position?` — ${staff.position}`:""}</option>)}</select></div>}{payment.method==="STORE_CREDIT"&&<div className="field"><label>Crédito do cliente</label><span className="input movement-readonly">{customerId?"Usar cliente selecionado":"Selecione um cliente acima"}</span></div>}<button className="btn btn-danger btn-small" type="button" onClick={()=>setPayments((current)=>current.filter((row)=>row.key!==payment.key))} disabled={!canEdit||payments.length===1} title="Remover pagamento"><Trash2 size={15}/></button></div>)}</div>
        <div className={`cash-reconciliation ${totalMatches?"cash-reconciliation-ok":"cash-reconciliation-error"}`}><div><small>Total da venda</small><strong>{money(details.sale.total_cents)}</strong></div><div><small>Total informado</small><strong>{money(informedTotal)}</strong></div><span>{totalMatches?"Valores conferem":`Diferença de ${money(Math.abs(Number(details.sale.total_cents)-informedTotal))}`}</span></div>
        <button className="btn btn-primary" type="button" onClick={save} disabled={!canSave||saving}><Save size={16}/> {saving?"Salvando...":"Salvar manutenção do movimento"}</button>
      </section>
      {details.sale.status==="COMPLETED"&&<section className="danger-zone movement-cancel-section"><div><strong>Cancelar esta venda</strong><p>O cancelamento devolve os itens ao estoque, anula pagamentos pendentes e fica registrado no Histórico.</p>{settledVoucher&&<p><strong>Bloqueado:</strong> há um vale de funcionário já quitado nesta venda.</p>}</div><form action={cancelSaleAction} className="movement-cancel-form"><input type="hidden" name="saleId" value={saleId}/><div className="field"><label>Motivo do cancelamento</label><input className="input" name="reason" minLength={4} maxLength={240} placeholder="Informe o motivo" required disabled={settledVoucher}/></div><ConfirmSubmitButton className="btn btn-danger" message={`Cancelar definitivamente a venda #${saleId}?`} disabled={settledVoucher}><Ban size={16}/> Cancelar venda</ConfirmSubmitButton></form></section>}
    </div>}
  </dialog></>;
}
