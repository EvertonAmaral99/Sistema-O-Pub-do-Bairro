import Link from "next/link";
import { CircleDollarSign, ListTodo, Save, Zap } from "lucide-react";
import { QuickSaleWorkspace } from "@/components/quick-sale-workspace";
import type { CommandProduct } from "@/components/command-product-picker";
import type { CustomerOption, StaffMemberOption } from "@/components/payment-form";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { quickSalePendingLabel } from "@/lib/quick-sale-draft";

export const dynamic="force-dynamic";

type PendingDraftRow={id:number;items:unknown;checkout_state:unknown;updated_at:Date|string};

export default async function QuickSalePage({searchParams}:{searchParams:Promise<{rascunho?:string;nova?:string;tipo?:string}>}){
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const params=await searchParams;
  const forceNew=params.nova==="1";
  const startAsDelivery=forceNew&&params.tipo==="delivery";
  const requestedDraftId=!forceNew&&/^\d+$/.test(params.rascunho??"")?Number(params.rascunho):null;
  const [products,staffMembers,customers,cash,draft]=await Promise.all([
    query<CommandProduct>(`SELECT p.id,p.name,p.category,p.price_cents,sp.stock_quantity,sp.unlimited AS stock_unlimited,sp.stock_kind,
      EXISTS(SELECT 1 FROM products linked WHERE linked.stock_pool_id=p.stock_pool_id AND linked.id<>p.id AND linked.deleted_at IS NULL) AS stock_shared,
      p.stock_per_sale_unit,(p.image_data IS NOT NULL) AS has_image,p.image_updated_at
      FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id
      WHERE p.active=TRUE AND p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%'
      ORDER BY p.category,p.name LIMIT 500`),
    query<StaffMemberOption>("SELECT id,name,position FROM staff_members WHERE active=TRUE ORDER BY name"),
    query<CustomerOption>(`SELECT id,name,cpf,contact,store_credit_balance_cents AS "balanceCents" FROM customers WHERE active=TRUE ORDER BY name LIMIT 500`),
    query<{open:boolean}>("SELECT EXISTS(SELECT 1 FROM cash_sessions WHERE status='OPEN') AS open"),
    query<PendingDraftRow>("SELECT id,items,checkout_state,updated_at FROM quick_sale_pending_orders WHERE id=$1",[requestedDraftId??0]),
  ]);
  const cashOpen=Boolean(cash.rows[0]?.open);
  const initialDraft=draft.rows[0]?{id:Number(draft.rows[0].id),items:draft.rows[0].items,checkoutState:draft.rows[0].checkout_state,updatedAt:new Date(draft.rows[0].updated_at).toISOString()}:null;
  return <>
    <div className="page-head quick-sale-page-head"><div><p className="eyebrow">Atendimento de balcão</p><h2>Venda rápida</h2><p>Adicione os itens, informe o pagamento e finalize sem abrir uma comanda.</p></div><div className="actions">{initialDraft&&<span className="badge badge-amber"><Save size={13}/> {quickSalePendingLabel(initialDraft.id)}</span>}<span className="badge badge-blue"><Zap size={13}/> Fluxo direto</span><span className={`badge ${cashOpen?"badge-green":"badge-red"}`}><CircleDollarSign size={13}/> Caixa {cashOpen?"aberto":"fechado"}</span><Link className="btn btn-light btn-small" href="/pendencias-venda"><ListTodo size={15}/> Pendências de venda</Link></div></div>
    {params.rascunho&&requestedDraftId!==null&&!initialDraft&&<div className="alert alert-error">Essa pendência de venda não existe mais. Uma nova venda rápida foi aberta.</div>}
    <QuickSaleWorkspace key={forceNew?(startAsDelivery?"new-delivery":"new"):initialDraft?`draft-${initialDraft.id}`:"default"} products={products.rows} staffMembers={staffMembers.rows} customers={customers.rows} cashOpen={cashOpen} userId={user.id} initialDraft={initialDraft} forceNew={forceNew} startAsDelivery={startAsDelivery}/>
  </>;
}
