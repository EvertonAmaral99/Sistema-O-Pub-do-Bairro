import { notFound } from "next/navigation";
import { PrintActions } from "@/components/print-actions";
import { BrandLogo } from "@/components/brand-logo";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export default async function KitchenPrintPage({ params, searchParams }: { params:Promise<{id:string}>; searchParams:Promise<{formato?:string}> }) {
  await requireRole(["ADMIN","MANAGER","CASHIER","KITCHEN"]); const ticketId=Number((await params).id); const format=(await searchParams).formato||"80";
  const header=await query<{id:number;command_number:number;table_number:number;customer_name:string|null;created_at:string;user_name:string}>(`SELECT kt.id,c.command_number,t.number AS table_number,c.customer_name,kt.created_at,u.name AS user_name FROM kitchen_tickets kt JOIN commands c ON c.id=kt.command_id JOIN bar_tables t ON t.id=c.table_id JOIN users u ON u.id=kt.created_by WHERE kt.id=$1`,[ticketId]);
  if(!header.rows[0]) notFound(); const items=await query<{product_name:string;quantity:number;destination:string}>(`SELECT oi.product_name,oi.quantity,oi.destination FROM kitchen_ticket_items kti JOIN order_items oi ON oi.id=kti.order_item_id WHERE kti.ticket_id=$1 ORDER BY oi.destination,oi.id`,[ticketId]); const data=header.rows[0];
  return <main className={`print-page ${format==="80"?"receipt-80":format==="58"?"receipt-58":""}`}><PrintActions/><header className="print-title"><BrandLogo className="print-logo"/><h1>O Pub do Bairro</h1><strong>PEDIDO DE PRODUÇÃO</strong></header><div className="divider"/><p><strong>Comanda:</strong> #{data.command_number}<br/><strong>Mesa:</strong> {data.table_number}<br/><strong>Cliente:</strong> {data.customer_name||"Não informado"}<br/><strong>Enviado:</strong> {formatDateTime(data.created_at)}<br/><strong>Operador:</strong> {data.user_name}</p><div className="divider"/>{["KITCHEN","BAR"].map(area=>{const filtered=items.rows.filter(i=>i.destination===area); if(!filtered.length)return null; return <section key={area}><h2 style={{fontSize:18}}>{area==="KITCHEN"?"COZINHA":"BAR"}</h2>{filtered.map((item,index)=><div className="total-row" key={`${item.product_name}-${index}`} style={{fontSize:16,margin:"11px 0"}}><strong>{item.quantity}×</strong><strong style={{flex:1}}>{item.product_name}</strong></div>)}<div className="divider"/></section>;})}<p style={{textAlign:"center"}}>Ticket #{data.id}</p></main>;
}
