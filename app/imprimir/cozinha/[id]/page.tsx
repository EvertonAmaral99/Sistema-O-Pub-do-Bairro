import { notFound } from "next/navigation";
import { PrintActions } from "@/components/print-actions";
import { BrandLogo } from "@/components/brand-logo";
import { requireAnyPermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { commandLabel } from "@/lib/command-label";

export const dynamic = "force-dynamic";
export default async function KitchenPrintPage({ params, searchParams }: { params:Promise<{id:string}>; searchParams:Promise<{formato?:string}> }) {
  await requireAnyPermission(["COMMANDS","KITCHEN"]); const ticketId=Number((await params).id); const format=(await searchParams).formato||"80";
  const header=await query<{id:number;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string;customer_name:string|null;created_at:string;user_name:string;priority:boolean;priority_note:string|null;delivery_id:number|null}>(`SELECT kt.id,c.command_number,c.command_name,c.sale_channel,cl.display_label AS table_display,c.customer_name,kt.created_at,u.name AS user_name,c.priority,c.priority_note,d.id AS delivery_id FROM kitchen_tickets kt JOIN commands c ON c.id=kt.command_id JOIN command_locations cl ON cl.command_id=c.id JOIN users u ON u.id=kt.created_by LEFT JOIN sales s ON s.command_id=c.id LEFT JOIN delivery_orders d ON d.sale_id=s.id WHERE kt.id=$1`,[ticketId]);
  if(!header.rows[0]) notFound(); const items=await query<{product_name:string;quantity:number|string;display_unit:string}>(`SELECT oi.product_name,oi.quantity,oi.display_unit FROM kitchen_ticket_items kti JOIN order_items oi ON oi.id=kti.order_item_id WHERE kti.ticket_id=$1 AND oi.destination='KITCHEN' ORDER BY oi.id`,[ticketId]); const data=header.rows[0];
  return <main className={`print-page ${format==="80"?"receipt-80":format==="58"?"receipt-58":""}`}><PrintActions/><header className="print-title"><BrandLogo className="print-logo"/><h1>O Pub do Bairro</h1><strong>PEDIDO DA COZINHA</strong></header><div className="divider"/>{data.priority&&<div className="print-priority"><strong>PRIORIDADE</strong><span>{data.priority_note}</span></div>}<p>{data.sale_channel==="QUICK_SALE"?<><strong>Tipo:</strong> {data.delivery_id?"Retirada por aplicativo":"Venda rápida"}<br/></>:<><strong>Comanda:</strong> {commandLabel(data)}<br/><strong>Mesa(s):</strong> {data.table_display}<br/></>}<strong>Cliente:</strong> {data.customer_name||"Não informado"}<br/><strong>Enviado:</strong> {formatDateTime(data.created_at)}<br/><strong>Operador:</strong> {data.user_name}</p><div className="divider"/><h2 style={{fontSize:18}}>COZINHA</h2>{items.rows.map((item,index)=><div className="total-row" key={`${item.product_name}-${index}`} style={{fontSize:16,margin:"11px 0"}}><strong>{formatQuantity(item.quantity,item.display_unit)}</strong><strong style={{flex:1}}>{item.product_name}</strong></div>)}<div className="divider"/><p style={{textAlign:"center"}}>Ticket #{data.id}</p></main>;
}
