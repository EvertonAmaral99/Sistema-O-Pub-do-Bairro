"use client";

import { useRef, useState } from "react";
import { Printer, X } from "lucide-react";

type SaleDetails={
  sale:{id:number;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string;customer_name:string|null;subtotal_cents:number;discount_cents:number;service_fee_cents:number;total_cents:number;split_count:number;status:string;created_at:string;user_name:string;delivery_id:number|null;delivery_status:string|null;pickup_code:string|null;courier_app_name:string|null;courier_app_code:string|null;collected_at:string|null};
  items:Array<{id:number;product_name:string;quantity:string;unit_price_cents:number;display_unit:string}>;
  payments:Array<{id:number;method:string;amount_cents:number;staff_member_name:string|null;customer_name:string|null}>;
};
const methods:Record<string,string>={CASH:"Dinheiro",PIX:"PIX",DEBIT:"Cartão de débito",CREDIT:"Cartão de crédito",STAFF_VOUCHER:"Vale funcionário",STORE_CREDIT:"Crédito em loja"};
const units:Record<string,string>={UNIT:"un.",KG:"kg",L:"L",PORTION:"porção",DOSE:"dose",BOTTLE:"garrafa",CAN:"lata"};
const deliveryStatuses:Record<string,string>={PREPARING:"Em preparo",READY:"Pronto para retirada",COLLECTED:"Retirado",CANCELLED:"Cancelado"};
function money(cents:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);}
function dateTime(value:string){return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(value));}

export function SaleDetailsButton({saleId}:{saleId:number}){
  const dialogRef=useRef<HTMLDialogElement>(null);
  const [details,setDetails]=useState<SaleDetails|null>(null);
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  async function openDetails(){
    dialogRef.current?.showModal();
    if(details||pending)return;
    setPending(true);setError("");
    try{const response=await fetch(`/api/sales/${saleId}`,{cache:"no-store"});const data=await response.json() as SaleDetails&{error?:string};if(!response.ok){setError(data.error||"Não foi possível abrir a venda.");return;}setDetails(data);}
    catch{setError("Não foi possível abrir a venda.");}finally{setPending(false);}
  }
  return <><button className="sale-number-button" type="button" onClick={openDetails}>Venda #{saleId}</button><dialog className="sale-details-dialog" ref={dialogRef}><div className="sale-details-head"><div><span className="eyebrow">Detalhes da venda</span><h3>Venda #{saleId}</h3>{details&&<p>{dateTime(details.sale.created_at)} · {details.sale.user_name}</p>}</div><form method="dialog"><button className="priority-dialog-close" type="submit" aria-label="Fechar"><X size={19}/></button></form></div>{pending&&<div className="empty">Carregando venda...</div>}{error&&<div className="alert alert-error">{error}</div>}{details&&<div className="sale-details-content"><div className="sale-details-meta"><span><small>Origem</small><strong>{details.sale.delivery_id?"Delivery · retirada por aplicativo":details.sale.sale_channel==="QUICK_SALE"?"Venda rápida":details.sale.command_name||`Comanda #${details.sale.command_number}`}</strong></span><span><small>{details.sale.sale_channel==="QUICK_SALE"?"Atendimento":"Mesa(s)"}</small><strong>{details.sale.delivery_id?deliveryStatuses[details.sale.delivery_status||""]||details.sale.delivery_status:details.sale.sale_channel==="QUICK_SALE"?"Balcão / caixa":details.sale.table_display}</strong></span><span><small>Cliente</small><strong>{details.sale.customer_name||"Não informado"}</strong></span><span><small>Situação</small><strong>{details.sale.status==="COMPLETED"?"Concluída":"Cancelada"}</strong></span></div>{details.sale.delivery_id&&<div className="alert alert-info"><strong>Pedido DEL-{String(details.sale.delivery_id).padStart(6,"0")}</strong> · Código de retirada: <strong>{details.sale.pickup_code}</strong> · Aplicativo: <strong>{details.sale.courier_app_name||"Não informado"}</strong> · Código do aplicativo: <strong>{details.sale.courier_app_code||"Não informado"}</strong>{details.sale.collected_at&&<> · Retirado em {dateTime(details.sale.collected_at)}</>}</div>}<section><h4>Produtos</h4><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{details.items.map((item)=><tr key={item.id}><td><strong>{item.product_name}</strong></td><td>{new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(Number(item.quantity))} {units[item.display_unit]||item.display_unit}</td><td>{money(item.unit_price_cents)}</td><td className="money">{money(Math.round(Number(item.quantity)*item.unit_price_cents))}</td></tr>)}</tbody></table></div></section><div className="sale-details-bottom"><section><h4>Pagamentos</h4>{details.payments.map((payment)=><div className="total-row" key={payment.id}><span>{methods[payment.method]||payment.method}{payment.staff_member_name&&<small> · {payment.staff_member_name}</small>}{payment.customer_name&&<small> · {payment.customer_name}</small>}</span><strong>{money(payment.amount_cents)}</strong></div>)}</section><section className="totals"><div className="total-row"><span>Subtotal</span><span>{money(details.sale.subtotal_cents)}</span></div>{details.sale.discount_cents>0&&<div className="total-row"><span>Desconto</span><span>- {money(details.sale.discount_cents)}</span></div>}{details.sale.service_fee_cents>0&&<div className="total-row"><span>Taxa</span><span>{money(details.sale.service_fee_cents)}</span></div>}<div className="total-row grand"><span>Total</span><strong>{money(details.sale.total_cents)}</strong></div></section></div><a className="btn btn-primary" href={`/imprimir/venda/${saleId}?formato=80`} target="_blank" rel="noreferrer"><Printer size={16}/> Reimprimir notinha</a></div>}</dialog></>;
}
