import { CircleDollarSign, Zap } from "lucide-react";
import { QuickSaleWorkspace } from "@/components/quick-sale-workspace";
import type { CommandProduct } from "@/components/command-product-picker";
import type { CustomerOption, StaffMemberOption } from "@/components/payment-form";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic="force-dynamic";

export default async function QuickSalePage(){
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
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
    query<{items:unknown;updated_at:Date|string}>("SELECT items,updated_at FROM quick_sale_drafts WHERE user_id=$1",[user.id]),
  ]);
  const cashOpen=Boolean(cash.rows[0]?.open);
  const initialDraft=draft.rows[0]?{items:draft.rows[0].items,updatedAt:new Date(draft.rows[0].updated_at).toISOString()}:null;
  return <>
    <div className="page-head quick-sale-page-head"><div><p className="eyebrow">Atendimento de balcão</p><h2>Venda rápida</h2><p>Adicione os itens, informe o pagamento e finalize sem abrir uma comanda.</p></div><div className="actions"><span className="badge badge-blue"><Zap size={13}/> Fluxo direto</span><span className={`badge ${cashOpen?"badge-green":"badge-red"}`}><CircleDollarSign size={13}/> Caixa {cashOpen?"aberto":"fechado"}</span></div></div>
    <QuickSaleWorkspace products={products.rows} staffMembers={staffMembers.rows} customers={customers.rows} cashOpen={cashOpen} userId={user.id} initialDraft={initialDraft}/>
  </>;
}
