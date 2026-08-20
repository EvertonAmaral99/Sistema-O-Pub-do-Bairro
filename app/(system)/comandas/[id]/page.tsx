import { notFound } from "next/navigation";
import { CircleAlert, Grid2X2, MinusCircle, Send, ShoppingCart, XCircle } from "lucide-react";
import { cancelCommandAction, removeItemAction, sendKitchenAction, updateCommandPriorityAction, updateCommandTablesAction } from "@/app/system-actions";
import { PriorityInfo } from "@/components/priority-info";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { canManageCommand } from "@/lib/roles";
import { PaymentForm, type CustomerOption } from "@/components/payment-form";
import { CommandProductPicker, type CommandProduct } from "@/components/command-product-picker";
import { PrintActionForm } from "@/components/print-action-form";
import { commandLabel } from "@/lib/command-label";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> };

export default async function CommandDetailPage({ params, searchParams }: Params) {
  const user=await requirePermission("COMMANDS");
  const canManage=canManageCommand(user.role);
  const commandId = Number((await params).id);
  const { erro } = await searchParams;
  const commandResult = await query<{ id: number; command_number: number|null; command_name:string|null; table_display: string; customer_name: string | null; opened_at: string; notes: string | null; status: string;priority:boolean;priority_note:string|null }>(`SELECT c.id,c.command_number,c.command_name,cl.display_label AS table_display,c.customer_name,c.opened_at,c.notes,c.status,c.priority,c.priority_note FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1`, [commandId]);
  const command = commandResult.rows[0]; if (!command) notFound();
  const [items, products, tables, staffMembers, customers] = await Promise.all([
    query<{ id: number; product_name: string; quantity: number|string; unit_price_cents: number; status: string; destination: string;display_unit:string }>("SELECT id,product_name,quantity,unit_price_cents,status,destination,display_unit FROM order_items WHERE command_id=$1 ORDER BY created_at DESC", [commandId]),
    query<CommandProduct>(`SELECT p.id,p.name,p.category,p.price_cents,sp.stock_quantity,sp.unlimited AS stock_unlimited,sp.stock_kind,
      EXISTS(SELECT 1 FROM products linked WHERE linked.stock_pool_id=p.stock_pool_id AND linked.id<>p.id AND linked.deleted_at IS NULL) AS stock_shared,
      p.stock_per_sale_unit,(p.image_data IS NOT NULL) AS has_image,p.image_updated_at FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.active=TRUE AND p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%' ORDER BY p.category,p.name LIMIT 500`),
    query<{id:number;number:number;label:string;selected:boolean}>(`SELECT bt.id,bt.number,COALESCE(bt.label,'Mesa '||bt.number) AS label,
      EXISTS(SELECT 1 FROM command_tables current_tables WHERE current_tables.command_id=$1 AND current_tables.table_id=bt.id) AS selected
      FROM bar_tables bt WHERE bt.active=TRUE OR EXISTS(SELECT 1 FROM command_tables current_tables WHERE current_tables.command_id=$1 AND current_tables.table_id=bt.id) ORDER BY bt.number`,[commandId]),
    query<{id:number;name:string;position:string|null}>("SELECT id,name,position FROM staff_members WHERE active=TRUE ORDER BY name"),
    query<CustomerOption>(`SELECT id,name,cpf,contact,store_credit_balance_cents AS "balanceCents" FROM customers WHERE active=TRUE ORDER BY name LIMIT 500`),
  ]);
  const activeItems = items.rows.filter((item) => item.status !== "CANCELLED");
  const subtotal = Math.round(activeItems.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0));
  const hasPrepPending = activeItems.some((item) => item.status === "PENDING" && item.destination === "KITCHEN");
  const statusLabel: Record<string,string> = { PENDING:"Novo",SENT:"Enviado",PREPARING:"Preparando",READY:"Pronto",DELIVERED:"Entregue",CANCELLED:"Removido" };
  return (
    <>
      <div className="page-head"><div><p className="eyebrow">{command.table_display}</p><h2>Comanda {commandLabel(command)}</h2><p>{command.customer_name || "Cliente não informado"} · Aberta em {formatDateTime(command.opened_at)}</p></div><div className="actions">{command.priority&&<span className="badge badge-red">Prioridade <PriorityInfo note={command.priority_note}/></span>}<span className={`badge ${command.status === "OPEN" ? "badge-green" : command.status === "CANCELLED" ? "badge-red" : "badge-gray"}`}>{command.status === "OPEN" ? "Aberta" : command.status === "CANCELLED" ? "Cancelada" : "Finalizada"}</span></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="split-layout command-detail-layout">
        <section className="card command-products-panel">
          <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Adicionar produtos</h3><p>Digite parte do nome para filtrar imediatamente.</p></div></div>
          <CommandProductPicker products={products.rows} commandId={commandId} commandOpen={command.status==="OPEN"}/>
        </section>
        <aside className={`card sticky-card command-options-panel ${command.priority ? "priority-alert" : ""}`}>
          {command.status === "OPEN"&&<details className="command-tables-editor"><summary><Grid2X2 size={17}/> Mesas desta comanda: {command.table_display}</summary><form action={updateCommandTablesAction} className="form-stack"><input type="hidden" name="commandId" value={command.id}/><div className="table-choice-grid command-table-choice-grid">{tables.rows.map((table)=><label className="table-choice" key={table.id}><input type="checkbox" name="tableIds" value={table.id} defaultChecked={table.selected}/><span><strong>{table.label}</strong><small>Mesa {table.number}</small></span></label>)}</div><button className="btn btn-primary btn-small" type="submit">Salvar mesas da comanda</button></form><div className="divider"/></details>}
          {command.status === "OPEN" && <><h3><CircleAlert size={17}/> Prioridade da comanda/mesa</h3>
            {command.priority ? <div className="form-stack priority-control"><div className="priority-current"><strong>Prioridade ativa</strong><PriorityInfo note={command.priority_note}/><p>{command.priority_note}</p></div><form action={updateCommandPriorityAction} className="form-stack"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} defaultValue={command.priority_note??""} rows={3} required/></div><button className="btn btn-primary btn-small" type="submit">Atualizar prioridade</button></form><form action={updateCommandPriorityAction}><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="false"/><button className="btn btn-light btn-small" type="submit">Remover prioridade</button></form></div> : <form action={updateCommandPriorityAction} className="form-stack priority-control"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} rows={3} placeholder="Ex.: cliente aguardando item atrasado" required/></div><button className="btn btn-danger" type="submit"><CircleAlert size={16}/> Marcar como prioridade</button></form>}
            <div className="divider"/></>}
          <h3><ShoppingCart size={17}/> Itens da comanda</h3>
          {activeItems.length === 0 ? <div className="empty" style={{ padding: "28px 12px" }}>Adicione o primeiro produto.</div> : <div className="form-stack">
            {activeItems.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 11 }}>
              <div><strong>{formatQuantity(item.quantity,item.display_unit)} · {item.product_name}</strong><div style={{ marginTop: 5 }}><span className={`badge ${item.destination!=="KITCHEN"||item.status === "PENDING" ? "badge-amber" : item.status === "READY" ? "badge-green" : "badge-blue"}`}>{item.destination!=="KITCHEN"?"Entrega pelo garçom":statusLabel[item.status]}</span></div></div>
              <div style={{ textAlign: "right" }}><span className="money">{formatMoney(item.unit_price_cents * Number(item.quantity))}</span>{command.status === "OPEN" && canManage && <form action={removeItemAction} style={{ marginTop: 6 }}><input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="itemId" value={item.id}/><button className="btn btn-danger btn-small" type="submit" title="Remover item"><MinusCircle size={14}/></button></form>}</div>
            </div>)}
          </div>}
          <div className="divider"/><div className="total-row grand"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          {command.status === "OPEN" && <>
            <div className="divider"/>
            <PrintActionForm action={sendKitchenAction} className="form-stack">
              <input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Formato do pedido</label><select className="select" name="format" defaultValue="58"><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
              <button className="btn btn-dark" type="submit" disabled={!hasPrepPending}><Send size={16}/> Enviar itens para a cozinha</button>
            </PrintActionForm>
            {!hasPrepPending&&<small style={{color:"var(--muted)"}}>Somente produtos cadastrados no setor Cozinha geram pedido de preparo.</small>}
            <div className="divider"/>
            {canManage?<><h3>Fechar comanda</h3><PaymentForm commandId={commandId} subtotal={subtotal} staffMembers={staffMembers.rows} customers={customers.rows}/><div className="divider"/><details className="cancel-command"><summary>Cancelar esta comanda</summary><form action={cancelCommandAction} className="form-stack"><input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Motivo do cancelamento</label><input className="input" name="reason" minLength={3} required/></div><button className="btn btn-danger" type="submit"><XCircle size={16}/> Cancelar comanda e devolver itens ao estoque</button></form></details></>:<div className="permission-lock"><span>Finalizar, cancelar ou alterar itens já lançados é permitido somente para Caixa, Gerente e Administrador.</span></div>}
          </>}
        </aside>
      </div>
    </>
  );
}
