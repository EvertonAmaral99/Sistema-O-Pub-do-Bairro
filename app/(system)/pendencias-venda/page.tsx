import Link from "next/link";
import { FileClock, Play, Plus, Trash2 } from "lucide-react";
import { discardQuickSalePendingAction } from "@/app/system-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { normalizeQuickSaleCheckoutDraft, quickSalePendingLabel, type QuickSaleCheckoutDraft } from "@/lib/quick-sale-draft";

export const dynamic="force-dynamic";

type PendingOrderRow={id:number;items:unknown;checkout_state:unknown;created_at:string;updated_at:string;created_by_name:string;updated_by_name:string};
type ProductRow={id:number;name:string;price_cents:number};
type CustomerRow={id:number;name:string};
type PendingItem={productId:number;quantity:number};

const paymentLabels={CASH:"Dinheiro",PIX:"PIX",DEBIT:"Cartão de débito",CREDIT:"Cartão de crédito",STAFF_VOUCHER:"Vale funcionário",STORE_CREDIT:"Crédito em loja"} as const;

function pendingItems(value:unknown):PendingItem[]{
  if(!Array.isArray(value))return[];
  return value.flatMap((entry)=>{
    if(!entry||typeof entry!=="object")return[];
    const source=entry as Record<string,unknown>;
    const productId=Math.trunc(Number(source.productId));
    const quantity=Math.trunc(Number(source.quantity));
    return Number.isSafeInteger(productId)&&productId>0&&Number.isSafeInteger(quantity)&&quantity>0?[{productId,quantity}]:[];
  });
}

function customerLabel(draft:QuickSaleCheckoutDraft,customers:Map<number,string>){
  if(draft.newCustomerOpen&&draft.newCustomerName.trim())return`${draft.newCustomerName.trim()} (cadastro pendente)`;
  const selected=customers.get(Number(draft.selectedCustomerId));
  if(selected)return selected;
  if(draft.customerSearch.trim())return`${draft.customerSearch.trim()} (sem cadastro)`;
  return"Não identificado";
}

function paymentLabel(draft:QuickSaleCheckoutDraft){
  if(draft.paymentMode==="MIXED")return"Pagamento misto";
  const people=Math.min(50,Math.max(1,Math.trunc(Number(draft.splitCount)||1)));
  if(people>1)return`Dividido entre ${people} pessoas`;
  return draft.paymentMethod?paymentLabels[draft.paymentMethod]:"Não informado";
}

export default async function PendingQuickSalesPage({searchParams}:{searchParams:Promise<{erro?:string;sucesso?:string}>}){
  await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const params=await searchParams;
  const [orders,products,customers]=await Promise.all([
    query<PendingOrderRow>(`SELECT q.id,q.items,q.checkout_state,q.created_at,q.updated_at,
      created_user.name AS created_by_name,updated_user.name AS updated_by_name
      FROM quick_sale_pending_orders q
      JOIN users created_user ON created_user.id=q.created_by
      JOIN users updated_user ON updated_user.id=q.updated_by
      ORDER BY q.updated_at DESC LIMIT 300`),
    query<ProductRow>("SELECT id,name,price_cents FROM products"),
    query<CustomerRow>("SELECT id,name FROM customers"),
  ]);
  const productsById=new Map(products.rows.map((product)=>[Number(product.id),product]));
  const customersById=new Map(customers.rows.map((customer)=>[Number(customer.id),customer.name]));
  const pending=orders.rows.map((order)=>{
    const items=pendingItems(order.items);
    const checkout=normalizeQuickSaleCheckoutDraft(order.checkout_state);
    const units=items.reduce((sum,item)=>sum+item.quantity,0);
    const subtotal=items.reduce((sum,item)=>sum+item.quantity*Number(productsById.get(item.productId)?.price_cents??0),0);
    const itemSummary=items.slice(0,3).map((item)=>`${item.quantity}× ${productsById.get(item.productId)?.name??"Produto removido"}`).join(" · ");
    return{...order,checkout,units,subtotal,itemSummary,extraItems:Math.max(0,items.length-3)};
  });

  return <>
    <div className="page-head"><div><p className="eyebrow">Atendimento de balcão</p><h2>Pendências de venda</h2><p>Continue pedidos da Venda rápida exatamente de onde foram deixados.</p></div><div className="actions"><span className="badge badge-amber"><FileClock size={13}/> {pending.length} pedido(s)</span><Link className="btn btn-primary" href="/venda-rapida?nova=1"><Plus size={16}/> Nova venda rápida</Link></div></div>
    {params.erro&&<div className="alert alert-error">{params.erro}</div>}{params.sucesso&&<div className="alert alert-success">Pendência de venda descartada.</div>}
    {pending.length===0?<div className="card empty pending-sales-empty"><FileClock size={30}/><strong>Nenhuma venda pendente</strong><span>Ao adicionar um produto na Venda rápida, o pedido aparecerá automaticamente aqui.</span></div>:<div className="table-wrap pending-sales-table"><table><thead><tr><th>Pedido</th><th>Atendimento</th><th>Itens</th><th>Cliente</th><th>Pagamento</th><th>Última atualização</th><th>Subtotal atual</th><th>Ações</th></tr></thead><tbody>{pending.map((order)=><tr key={order.id}>
      <td><Link className="pending-sale-number" href={`/venda-rapida?rascunho=${order.id}`}>{quickSalePendingLabel(order.id)}</Link><br/><small>Criado por {order.created_by_name}<br/>{formatDateTime(order.created_at)}</small></td>
      <td><span className={`badge ${order.checkout.fulfillmentType==="APP_PICKUP"?"badge-blue":"badge-gray"}`}>{order.checkout.fulfillmentType==="APP_PICKUP"?"Retirada por aplicativo":"Balcão"}</span></td>
      <td><strong>{order.units} unidade(s)</strong><br/><small>{order.itemSummary}{order.extraItems>0?` · +${order.extraItems} produto(s)`:""}</small></td>
      <td>{customerLabel(order.checkout,customersById)}</td>
      <td>{paymentLabel(order.checkout)}</td>
      <td>{formatDateTime(order.updated_at)}<br/><small>por {order.updated_by_name}</small></td>
      <td className="money"><strong>{formatMoney(order.subtotal)}</strong></td>
      <td><div className="actions"><Link className="btn btn-primary btn-small" href={`/venda-rapida?rascunho=${order.id}`}><Play size={14}/> Continuar</Link><form action={discardQuickSalePendingAction}><input type="hidden" name="quickSaleDraftId" value={order.id}/><ConfirmSubmitButton className="btn btn-danger btn-small" message={`Descartar o pedido ${quickSalePendingLabel(order.id)}?`}><Trash2 size={14}/> Descartar</ConfirmSubmitButton></form></div></td>
    </tr>)}</tbody></table></div>}
  </>;
}
