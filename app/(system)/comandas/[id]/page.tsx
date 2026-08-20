import { notFound } from "next/navigation";
import { CircleAlert, CreditCard, Grid2X2, MinusCircle, ReceiptText, Send, ShoppingCart, UtensilsCrossed, XCircle } from "lucide-react";
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
  const itemCount = Math.trunc(activeItems.reduce((sum,item)=>sum+Number(item.quantity),0));
  const hasPrepPending = activeItems.some((item) => item.status === "PENDING" && item.destination === "KITCHEN");
  const statusLabel: Record<string,string> = { PENDING:"Novo",SENT:"Enviado",PREPARING:"Preparando",READY:"Pronto",DELIVERED:"Entregue",CANCELLED:"Removido" };
  const commandStatusLabel=command.status === "OPEN" ? "Aberta" : command.status === "CANCELLED" ? "Cancelada" : "Finalizada";
  const commandStatusClass=command.status === "OPEN" ? "badge-green" : command.status === "CANCELLED" ? "badge-red" : "badge-gray";

  return (
    <>
      <div className="page-head"><div><p className="eyebrow">{command.table_display}</p><h2>Comanda {commandLabel(command)}</h2><p>{command.customer_name || "Cliente não informado"} · Aberta em {formatDateTime(command.opened_at)}</p></div><div className="actions">{command.priority&&<span className="badge badge-red">Prioridade <PriorityInfo note={command.priority_note}/></span>}<span className={`badge ${commandStatusClass}`}>{commandStatusLabel}</span></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="split-layout command-detail-layout">
        <section className="card command-products-panel">
          <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Adicionar produtos</h3><p>Digite parte do nome para filtrar imediatamente.</p></div></div>
          <CommandProductPicker products={products.rows} commandId={commandId} commandOpen={command.status==="OPEN"}/>
        </section>

        <aside className={`card sticky-card command-options-panel ${command.priority ? "priority-alert" : ""}`}>
          <div className="command-info-header">
            <div className="command-info-title">
              <h3><ReceiptText size={18}/> Informações do pedido</h3>
              <span className={`badge ${commandStatusClass}`}>{commandStatusLabel}</span>
            </div>
            <div className="command-info-summary">
              <div className="command-info-summary-item"><small>Comanda</small><strong>{commandLabel(command)}</strong></div>
              <div className="command-info-summary-item"><small>Mesa</small><strong>{command.table_display}</strong></div>
              <div className="command-info-summary-item"><small>Itens</small><strong>{itemCount.toLocaleString("pt-BR")} {itemCount===1?"item":"itens"}</strong></div>
              <div className="command-info-summary-item command-info-total"><small>Subtotal</small><strong>{formatMoney(subtotal)}</strong></div>
            </div>
          </div>

          {command.status === "OPEN" && <section className="command-info-section">
            <div className="command-info-section-head"><div className="command-info-section-title"><Grid2X2 size={17}/><div><h3>Mesa e localização</h3><p>{command.table_display}</p></div></div></div>
            <details className="command-info-details">
              <summary><Grid2X2 size={15}/> Alterar mesas vinculadas</summary>
              <div className="command-info-details-body">
                <form action={updateCommandTablesAction} className="form-stack"><input type="hidden" name="commandId" value={command.id}/><div className="table-choice-grid command-table-choice-grid">{tables.rows.map((table)=><label className="table-choice" key={table.id}><input type="checkbox" name="tableIds" value={table.id} defaultChecked={table.selected}/><span><strong>{table.label}</strong><small>Mesa {table.number}</small></span></label>)}</div><button className="btn btn-primary btn-small" type="submit">Salvar mesas da comanda</button></form>
              </div>
            </details>
          </section>}

          {command.status === "OPEN" && <section className="command-info-section">
            <div className="command-info-section-head"><div className="command-info-section-title"><CircleAlert size={17}/><div><h3>Prioridade</h3><p>{command.priority?"Esta comanda está marcada como prioridade.":"Use apenas quando o pedido precisar de atenção especial."}</p></div></div>{command.priority&&<span className="badge badge-red">Ativa</span>}</div>
            {command.priority&&<div className="priority-current"><strong>Motivo atual</strong><PriorityInfo note={command.priority_note}/><p>{command.priority_note}</p></div>}
            <details className="command-info-details" open={command.priority}>
              <summary><CircleAlert size={15}/> {command.priority?"Editar prioridade":"Marcar como prioridade"}</summary>
              <div className="command-info-details-body">
                {command.priority ? <div className="form-stack priority-control"><form action={updateCommandPriorityAction} className="form-stack"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} defaultValue={command.priority_note??""} rows={3} required/></div><button className="btn btn-primary btn-small" type="submit">Atualizar prioridade</button></form><form action={updateCommandPriorityAction}><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="false"/><button className="btn btn-light btn-small" type="submit">Remover prioridade</button></form></div> : <form action={updateCommandPriorityAction} className="form-stack priority-control"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} rows={3} placeholder="Ex.: cliente aguardando item atrasado" required/></div><button className="btn btn-danger" type="submit"><CircleAlert size={16}/> Marcar como prioridade</button></form>}
              </div>
            </details>
          </section>}

          <section className="command-info-section">
            <div className="command-info-section-head"><div className="command-info-section-title"><ShoppingCart size={17}/><div><h3>Itens do pedido</h3><p>{itemCount===0?"Nenhum item lançado ainda.":`${itemCount.toLocaleString("pt-BR")} ${itemCount===1?"item lançado":"itens lançados"}`}</p></div></div></div>
            {activeItems.length === 0 ? <div className="empty" style={{ padding: "24px 12px" }}>Adicione o primeiro produto.</div> : <div className="command-items-list">
              {activeItems.map((item) => <div className="command-item-row" key={item.id}>
                <div className="command-item-main"><strong>{formatQuantity(item.quantity,item.display_unit)} · {item.product_name}</strong><div className="command-item-meta"><span className={`badge ${item.destination!=="KITCHEN"||item.status === "PENDING" ? "badge-amber" : item.status === "READY" ? "badge-green" : "badge-blue"}`}>{item.destination!=="KITCHEN"?"Entrega pelo garçom":statusLabel[item.status]}</span></div></div>
                <div className="command-item-value"><span className="money">{formatMoney(item.unit_price_cents * Number(item.quantity))}</span>{command.status === "OPEN" && canManage && <form action={removeItemAction}><input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="itemId" value={item.id}/><button className="btn btn-danger btn-small" type="submit" title="Remover item"><MinusCircle size={14}/></button></form>}</div>
              </div>)}
            </div>}
            <div className="command-subtotal-box"><span>Subtotal da comanda</span><strong>{formatMoney(subtotal)}</strong></div>
          </section>

          {command.status === "OPEN" && <section className="command-info-section">
            <div className="command-info-section-head"><div className="command-info-section-title"><UtensilsCrossed size={17}/><div><h3>Cozinha</h3><p>Envie somente os novos itens que precisam de preparo.</p></div></div></div>
            <PrintActionForm action={sendKitchenAction} className="form-stack">
              <input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Formato do pedido</label><select className="select" name="format" defaultValue="58"><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
              <button className="btn btn-dark" type="submit" disabled={!hasPrepPending}><Send size={16}/> Enviar itens para a cozinha</button>
            </PrintActionForm>
            {!hasPrepPending&&<p className="command-info-muted">Não há novos itens da cozinha aguardando envio.</p>}
          </section>}

          {command.status === "OPEN" && <section className="command-info-section command-info-section-payment">
            <div className="command-info-section-head"><div className="command-info-section-title"><CreditCard size={17}/><div><h3>Fechamento e pagamento</h3><p>Confira os valores e finalize a comanda.</p></div></div></div>
            {canManage?<PaymentForm commandId={commandId} subtotal={subtotal} staffMembers={staffMembers.rows} customers={customers.rows}/>:<div className="permission-lock"><span>Finalizar, cancelar ou alterar itens já lançados é permitido somente para Caixa, Gerente e Administrador.</span></div>}
          </section>}

          {command.status === "OPEN" && canManage && <section className="command-info-section command-info-danger">
            <details className="command-info-details cancel-command"><summary><XCircle size={15}/> Cancelar esta comanda</summary><div className="command-info-details-body"><form action={cancelCommandAction} className="form-stack"><input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Motivo do cancelamento</label><input className="input" name="reason" minLength={3} required/></div><button className="btn btn-danger" type="submit"><XCircle size={16}/> Cancelar comanda e devolver itens ao estoque</button></form></div></details>
          </section>}
        </aside>
      </div>
    </>
  );
}
