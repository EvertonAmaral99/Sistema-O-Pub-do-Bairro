import { notFound,redirect } from "next/navigation";
import { PrintActions } from "@/components/print-actions";
import { BrandLogo } from "@/components/brand-logo";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { commandLabel } from "@/lib/command-label";
import { paymentMethodLabel } from "@/lib/payments";
import { firstAllowedPath,hasPermission,type Permission } from "@/lib/roles";

export const dynamic="force-dynamic";

export default async function SalePrintPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{formato?:string}>}){
  const user=await requireUser();
  const saleId=Number((await params).id);
  const format=(await searchParams).formato||"80";
  const sale=await query<{id:number;command_id:number;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string;customer_name:string|null;subtotal_cents:number;discount_cents:number;service_fee_cents:number;total_cents:number;split_count:number;status:string;created_at:string;cancelled_at:string|null;cancellation_reason:string|null;user_name:string;delivery_id:number|null;pickup_code:string|null}>(`SELECT s.id,c.id AS command_id,c.command_number,c.command_name,c.sale_channel,cl.display_label AS table_display,COALESCE(customer.name,c.customer_name) AS customer_name,s.subtotal_cents,s.discount_cents,s.service_fee_cents,s.total_cents,s.split_count,s.status,s.created_at,s.cancelled_at,s.cancellation_reason,u.name AS user_name,d.id AS delivery_id,d.pickup_code
    FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id JOIN users u ON u.id=s.created_by LEFT JOIN customers customer ON customer.id=s.customer_id LEFT JOIN delivery_orders d ON d.sale_id=s.id WHERE s.id=$1`,[saleId]);
  if(!sale.rows[0])notFound();
  const data=sale.rows[0];
  const printPermissions:Permission[]=data.sale_channel==="QUICK_SALE"?["QUICK_SALES","DELIVERY","CASH","REPORTS","MOVEMENT_MAINTENANCE"]:["COMMANDS","CASH","REPORTS","MOVEMENT_MAINTENANCE"];
  const canPrint=printPermissions.some((permission)=>hasPermission(user,permission));
  if(!canPrint)redirect(`${firstAllowedPath(user)}?erro=permissao`);
  const [items,payments]=await Promise.all([
    query<{product_name:string;quantity:number|string;unit_price_cents:number;display_unit:string}>("SELECT product_name,quantity,unit_price_cents,display_unit FROM order_items WHERE command_id=$1 AND (status<>'CANCELLED' OR ($2::timestamptz IS NOT NULL AND cancelled_at=$2::timestamptz)) ORDER BY id",[data.command_id,data.cancelled_at]),
    query<{method:string;amount_cents:number;staff_member_name:string|null;customer_name:string|null}>("SELECT p.method,p.amount_cents,COALESCE(sm.name,p.staff_member_name) AS staff_member_name,c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN staff_members sm ON sm.id=p.staff_member_id WHERE p.sale_id=$1 AND p.voided_at IS NULL ORDER BY p.id",[saleId]),
  ]);
  const quickSale=data.sale_channel==="QUICK_SALE";
  return <main className={`print-page ${format==="80"?"receipt-80":format==="58"?"receipt-58":""}`}>
    <PrintActions backHref={data.delivery_id?"/delivery":quickSale?"/venda-rapida":"/painel"}/>
    <header className="print-title"><BrandLogo className="print-logo"/><h1>O Pub do Bairro</h1><strong>{data.status==="CANCELLED"?"VENDA CANCELADA":"COMPROVANTE DA VENDA"}</strong></header>
    <p style={{textAlign:"center"}}>Venda #{data.id} · {formatDateTime(data.created_at)}</p><div className="divider"/>
    <p>{quickSale?<><strong>Tipo:</strong> {data.delivery_id?"Retirada por aplicativo":"Venda rápida"}<br/></>:<><strong>Comanda:</strong> {commandLabel(data)}<br/><strong>Mesa(s):</strong> {data.table_display}<br/></>}<strong>Cliente:</strong> {data.customer_name||"Não informado"}<br/><strong>Atendente:</strong> {data.user_name}</p>{data.status==="CANCELLED"&&<p><strong>Situação:</strong> Venda cancelada{data.cancellation_reason&&<><br/><strong>Motivo:</strong> {data.cancellation_reason}</>}</p>}{data.delivery_id&&data.status!=="CANCELLED"&&<section className="print-delivery-code"><strong>CÓDIGO DE RETIRADA</strong><span>{data.pickup_code}</span><small>Informe estes 4 números ao cliente. O motoboy deverá dizer o mesmo código no balcão para retirar o pedido.</small></section>}<div className="divider"/>
    {items.rows.map((item,index)=><div key={index} style={{marginBottom:9}}><div className="total-row"><span>{formatQuantity(item.quantity,item.display_unit)} · {item.product_name}</span><strong>{formatMoney(Number(item.quantity)*item.unit_price_cents)}</strong></div><small>{formatMoney(item.unit_price_cents)} por unidade</small></div>)}
    <div className="divider"/><div className="totals"><div className="total-row"><span>Subtotal</span><span>{formatMoney(data.subtotal_cents)}</span></div>{data.discount_cents>0&&<div className="total-row"><span>Desconto</span><span>- {formatMoney(data.discount_cents)}</span></div>}{data.service_fee_cents>0&&<div className="total-row"><span>Taxa de serviço</span><span>{formatMoney(data.service_fee_cents)}</span></div>}<div className="total-row grand"><span>Total</span><span>{formatMoney(data.total_cents)}</span></div>{data.split_count>1&&<div className="total-row"><span>Dividido entre {data.split_count} pessoas</span><strong>{formatMoney(Math.round(data.total_cents/data.split_count))} por pessoa</strong></div>}</div>
    <div className="divider"/><strong>Pagamento</strong>{payments.rows.map((payment,index)=><div className="total-row" key={index} style={{marginTop:7}}><span>{paymentMethodLabel(payment.method)}{payment.staff_member_name&&<small> · {payment.staff_member_name}</small>}{payment.customer_name&&<small> · {payment.customer_name}</small>}</span><span>{formatMoney(payment.amount_cents)}</span></div>)}<div className="divider"/><p style={{textAlign:"center"}}>Obrigado pela preferência!</p>
  </main>;
}
