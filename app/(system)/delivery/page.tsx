import Link from "next/link";
import { Ban, Bike, CircleCheck, Clock3, KeyRound, PackageCheck, Plus, Printer, Save, ShieldCheck } from "lucide-react";
import { confirmDeliveryPickupAction,saveDeliveryAppCodeAction } from "@/app/system-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LiveRefresh } from "@/components/live-refresh";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { courierAppCodeLabel,courierAppCodeState,deliveryOrderLabel,deliveryStatusLabel,type DeliveryStatus } from "@/lib/delivery";
import { formatDateTime,formatMoney,formatQuantity } from "@/lib/format";

export const dynamic="force-dynamic";

type DeliveryRow={
  id:number;sale_id:number;command_id:number;pickup_code:string;courier_app_code:string|null;courier_app_code_not_required:boolean;status:DeliveryStatus;
  failed_attempts:number;locked:boolean;created_at:string;updated_at:string;ready_at:string|null;collected_at:string|null;cancelled_at:string|null;
  total_cents:number;customer_name:string|null;customer_contact:string|null;created_by_name:string;ready_by_name:string|null;collected_by_name:string|null;cancelled_by_name:string|null;
};
type DeliveryItemRow={delivery_id:number;product_name:string;quantity:number|string;display_unit:string;destination:string;status:string};

const statusBadge:Record<DeliveryStatus,string>={PREPARING:"badge-blue",READY:"badge-green",COLLECTED:"badge-gray",CANCELLED:"badge-red"};

export default async function DeliveryPage({searchParams}:{searchParams:Promise<{erro?:string;codigo?:string;retirada?:string;pedido?:string}>}){
  await requirePermission("DELIVERY");
  const params=await searchParams;
  const [orders,items]=await Promise.all([
    query<DeliveryRow>(`SELECT d.id,d.sale_id,s.command_id,d.pickup_code,d.courier_app_code,d.courier_app_code_not_required,d.status,d.failed_attempts,
      (d.failed_attempts>=5 AND d.last_failed_at>NOW()-INTERVAL '5 minutes') AS locked,
      d.created_at,d.updated_at,d.ready_at,d.collected_at,d.cancelled_at,s.total_cents,
      COALESCE(customer.name,c.customer_name) AS customer_name,customer.contact AS customer_contact,
      creator.name AS created_by_name,ready_user.name AS ready_by_name,collected_user.name AS collected_by_name,cancelled_user.name AS cancelled_by_name
      FROM delivery_orders d JOIN sales s ON s.id=d.sale_id JOIN commands c ON c.id=s.command_id
      JOIN users creator ON creator.id=d.created_by LEFT JOIN customers customer ON customer.id=s.customer_id
      LEFT JOIN users ready_user ON ready_user.id=d.ready_by LEFT JOIN users collected_user ON collected_user.id=d.collected_by LEFT JOIN users cancelled_user ON cancelled_user.id=d.cancelled_by
      WHERE d.status IN ('PREPARING','READY') OR d.updated_at>=NOW()-INTERVAL '7 days'
      ORDER BY CASE d.status WHEN 'READY' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,d.updated_at DESC LIMIT 150`),
    query<DeliveryItemRow>(`SELECT d.id AS delivery_id,oi.product_name,oi.quantity,oi.display_unit,oi.destination,oi.status
      FROM delivery_orders d JOIN sales s ON s.id=d.sale_id JOIN order_items oi ON oi.command_id=s.command_id
      WHERE (d.status IN ('PREPARING','READY') OR d.updated_at>=NOW()-INTERVAL '7 days') AND oi.status<>'CANCELLED' ORDER BY d.id,oi.id`),
  ]);
  const itemsByDelivery=new Map<number,DeliveryItemRow[]>();
  for(const item of items.rows){const id=Number(item.delivery_id);itemsByDelivery.set(id,[...(itemsByDelivery.get(id)??[]),item]);}
  const active=orders.rows.filter((order)=>order.status==="PREPARING"||order.status==="READY");
  const history=orders.rows.filter((order)=>order.status==="COLLECTED"||order.status==="CANCELLED").slice(0,50);
  const collectedToday=orders.rows.filter((order)=>order.status==="COLLECTED"&&order.collected_at&&new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"}).format(new Date(order.collected_at))===new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"}).format(new Date())).length;

  return <>
    <LiveRefresh intervalMs={5000}/>
    <div className="page-head"><div><p className="eyebrow">Retirada por aplicativo</p><h2>Delivery</h2><p>Acompanhe o preparo, registre o código do aplicativo e só libere após confirmar os 4 dígitos informados pelo motoboy.</p></div><Link className="btn btn-primary" href="/venda-rapida?nova=1&tipo=delivery"><Plus size={16}/> Nova retirada</Link></div>
    {params.erro&&<div className="alert alert-error">{params.erro}</div>}
    {params.codigo&&<div className="alert alert-success">{params.codigo==="sem-codigo"?"Pedido marcado como sem código do aplicativo":"Código do aplicativo salvo"} {params.pedido?`em ${deliveryOrderLabel(Number(params.pedido))}`:""}.</div>}
    {params.retirada&&<div className="alert alert-success"><CircleCheck size={17}/> Código confirmado. O pedido {params.pedido?deliveryOrderLabel(Number(params.pedido)):""} foi liberado para retirada.</div>}
    <div className="grid grid-3 delivery-stats"><div className="card stat"><Clock3/><span className="stat-label">Em preparo</span><strong className="stat-value">{active.filter((order)=>order.status==="PREPARING").length}</strong></div><div className="card stat"><PackageCheck/><span className="stat-label">Prontos para retirada</span><strong className="stat-value">{active.filter((order)=>order.status==="READY").length}</strong></div><div className="card stat"><Bike/><span className="stat-label">Retirados hoje</span><strong className="stat-value">{collectedToday}</strong></div></div>

    <div className="delivery-section-head"><div><p className="label">PEDIDOS ATIVOS</p><h3>Preparo e retirada</h3></div><span className="badge badge-amber">{active.length} pedido(s)</span></div>
    {active.length===0?<div className="card empty delivery-empty"><Bike size={32}/><strong>Nenhum delivery aguardando retirada</strong><span>Selecione “Retirada por aplicativo” ao finalizar uma Venda rápida.</span></div>:<div className="delivery-grid">{active.map((order)=>{
      const orderItems=itemsByDelivery.get(Number(order.id))??[];
      const kitchenItems=orderItems.filter((item)=>item.destination==="KITCHEN");
      const readyKitchen=kitchenItems.filter((item)=>item.status==="READY"||item.status==="DELIVERED").length;
      const summary=orderItems.slice(0,4).map((item)=>`${formatQuantity(item.quantity,item.display_unit)} ${item.product_name}`).join(" · ");
      const highlighted=String(order.id)===params.pedido;
      const courierCodeState=courierAppCodeState(order.courier_app_code,order.courier_app_code_not_required);
      const courierCodeResolved=courierCodeState!=="PENDING";
      return <article className={`card delivery-card ${order.status.toLocaleLowerCase()} ${highlighted?"highlighted":""}`} key={order.id}>
        <div className="delivery-card-head"><div><span className="delivery-order-number">{deliveryOrderLabel(Number(order.id))}</span><small>Venda #{order.sale_id} · {formatDateTime(order.created_at)}</small></div><span className={`badge ${statusBadge[order.status]}`}>{deliveryStatusLabel[order.status]}</span></div>
        <div className="delivery-customer"><strong>{order.customer_name||"Cliente não identificado"}</strong>{order.customer_contact&&<small>{order.customer_contact}</small>}</div>
        <div className="delivery-item-summary"><strong>{orderItems.length} produto(s) · {formatMoney(order.total_cents)}</strong><small>{summary}{orderItems.length>4?` · +${orderItems.length-4} produto(s)`:""}</small><span>{kitchenItems.length>0?`${readyKitchen} de ${kitchenItems.length} item(ns) da cozinha pronto(s)`:"Pedido sem preparo de cozinha"}</span></div>
        <details className="delivery-secret"><summary><KeyRound size={15}/> Mostrar código para informar ao cliente</summary><strong>{order.pickup_code}</strong><small>Este é o código que o motoboy deverá dizer no balcão.</small></details>
        <form className="delivery-app-form" action={saveDeliveryAppCodeAction}><input type="hidden" name="deliveryId" value={order.id}/><div className="delivery-app-code-head"><div><strong>Código do aplicativo para o motoboy</strong><small>Informe o código recebido do cliente. Se esse pedido não tiver código, registre essa condição no botão ao lado.</small></div><span className={`badge ${courierCodeState==="INFORMED"?"badge-green":courierCodeState==="NOT_REQUIRED"?"badge-gray":"badge-amber"}`}>{courierCodeState==="INFORMED"?"Código informado":courierCodeState==="NOT_REQUIRED"?"Sem código":"Pendente"}</span></div><div className="field"><label>Código do aplicativo</label><input className="input" name="courierAppCode" defaultValue={order.courier_app_code??""} maxLength={40} autoComplete="off" placeholder="Informe o código recebido do cliente"/></div><div className="delivery-app-actions"><button className="btn btn-light btn-small" type="submit" name="codeMode" value="CODE"><Save size={15}/> Salvar código</button><ConfirmSubmitButton className="btn btn-light btn-small" name="codeMode" value="NONE" message={`Marcar o pedido ${deliveryOrderLabel(Number(order.id))} como sem código do aplicativo?`}><Ban size={15}/> Marcar sem código</ConfirmSubmitButton></div></form>
        <div className="delivery-pickup-panel"><div><ShieldCheck size={22}/><span><strong>Confirmação da retirada</strong><small>{order.status==="PREPARING"?"Aguarde todos os itens da cozinha ficarem prontos.":courierCodeResolved?"Peça ao motoboy o código de retirada de 4 dígitos e digite abaixo.":"Informe o código do aplicativo ou marque o pedido como sem código antes de liberar."}</small></span></div>{order.status==="READY"&&<form className="delivery-pickup-form" action={confirmDeliveryPickupAction}><input type="hidden" name="deliveryId" value={order.id}/><input className="input delivery-code-input" name="pickupCode" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="off" placeholder="0000" aria-label="Código de retirada informado pelo motoboy" required/><ConfirmSubmitButton className="btn btn-primary" message={`Confirmar a retirada do pedido ${deliveryOrderLabel(Number(order.id))}?`} disabled={!courierCodeResolved||order.locked}><PackageCheck size={16}/> Confirmar e liberar</ConfirmSubmitButton></form>}{order.failed_attempts>0&&<small className="delivery-attempt-warning">{order.locked?"Confirmação bloqueada por 5 minutos após tentativas incorretas.":`${order.failed_attempts} tentativa(s) incorreta(s) recente(s).`}</small>}</div>
        <a className="btn btn-light btn-small" href={`/imprimir/venda/${order.sale_id}?formato=80`} target="_blank" rel="noreferrer"><Printer size={15}/> Reimprimir notinha</a>
      </article>;
    })}</div>}

    <div className="delivery-section-head"><div><p className="label">HISTÓRICO RECENTE</p><h3>Retirados e cancelados</h3></div></div>
    {history.length===0?<div className="card empty">Nenhum pedido concluído nos últimos 7 dias.</div>:<div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Venda</th><th>Cliente</th><th>Situação</th><th>Código do aplicativo</th><th>Concluído em</th><th>Operador</th></tr></thead><tbody>{history.map((order)=><tr key={order.id}><td><strong>{deliveryOrderLabel(Number(order.id))}</strong></td><td>#{order.sale_id}</td><td>{order.customer_name||"Não identificado"}</td><td><span className={`badge ${statusBadge[order.status]}`}>{deliveryStatusLabel[order.status]}</span></td><td>{courierAppCodeLabel(order.courier_app_code,order.courier_app_code_not_required)}</td><td>{formatDateTime(order.collected_at||order.cancelled_at||order.updated_at)}</td><td>{order.status==="COLLECTED"?order.collected_by_name:order.cancelled_by_name}</td></tr>)}</tbody></table></div>}
  </>;
}
