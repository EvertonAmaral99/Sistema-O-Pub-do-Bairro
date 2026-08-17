import { Radio } from "lucide-react";
import { updateKitchenStatusAction } from "@/app/system-actions";
import { LiveRefresh } from "@/components/live-refresh";
import { PriorityInfo } from "@/components/priority-info";
import { query } from "@/lib/db";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { saleReferenceLabel } from "@/lib/command-label";

export default async function KitchenPage() {
  await requirePermission("KITCHEN");
  const items = await query<{ id:number; product_name:string; quantity:number|string;display_unit:string; status:string; command_number:number|null; command_name:string|null;sale_channel:string; table_display:string; sent_at:string;priority:boolean;priority_note:string|null }>(`SELECT oi.id,oi.product_name,oi.quantity,oi.display_unit,oi.status,c.command_number,c.command_name,c.sale_channel,cl.display_label AS table_display,oi.sent_at,c.priority,c.priority_note
    FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN command_locations cl ON cl.command_id=c.id
    WHERE oi.destination='KITCHEN' AND oi.status IN ('SENT','PREPARING','READY') ORDER BY c.priority DESC,CASE oi.status WHEN 'READY' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,oi.sent_at`);
  const columns = [{status:"SENT",title:"Aguardando",badge:"badge-amber"},{status:"PREPARING",title:"Em preparo",badge:"badge-blue"},{status:"READY",title:"Prontos",badge:"badge-green"}];
  return <><LiveRefresh/><div className="page-head"><div><p className="eyebrow">Produção</p><h2>Cozinha</h2><p>Somente os itens que precisam de preparo aparecem nesta tela.</p></div><span className="badge badge-blue"><Radio size={13}/> Atualização automática</span></div>
    <div className="grid grid-3">{columns.map(column=><section className="card" key={column.status}><h3>{column.title} <span className={`badge ${column.badge}`}>{items.rows.filter(i=>i.status===column.status).length}</span></h3><div className="form-stack">
      {items.rows.filter(i=>i.status===column.status).length===0?<div className="empty" style={{padding:"26px 8px"}}>Nenhum item.</div>:items.rows.filter(i=>i.status===column.status).map(item=><article key={item.id} className={`kitchen-item-card ${item.priority?"priority-alert":""}`}><div className="command-top"><strong>{formatQuantity(item.quantity,item.display_unit)} · {item.product_name}</strong><span className="badge badge-amber">Cozinha</span></div>{item.priority&&<div className="priority-label">Prioridade <PriorityInfo note={item.priority_note}/></div>}<p>{saleReferenceLabel(item)}<br/>{formatDateTime(item.sent_at)}</p>
        <form action={updateKitchenStatusAction}><input type="hidden" name="itemId" value={item.id}/><input type="hidden" name="status" value={item.status==="SENT"?"PREPARING":item.status==="PREPARING"?"READY":"DELIVERED"}/><button className="btn btn-dark btn-small" type="submit">{item.status==="SENT"?"Iniciar preparo":item.status==="PREPARING"?"Marcar como pronto":"Marcar como entregue"}</button></form>
      </article>)}</div></section>)}</div>
  </>;
}
