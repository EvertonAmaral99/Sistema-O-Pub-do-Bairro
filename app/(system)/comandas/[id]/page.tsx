import Image from "next/image";
import { notFound } from "next/navigation";
import { CircleAlert, ImageIcon, MinusCircle, Send, ShoppingCart, XCircle } from "lucide-react";
import { addItemAction, cancelCommandAction, removeItemAction, sendKitchenAction, updateCommandPriorityAction } from "@/app/system-actions";
import { PriorityInfo } from "@/components/priority-info";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PaymentForm } from "@/components/payment-form";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; busca?: string }> };

export default async function CommandDetailPage({ params, searchParams }: Params) {
  await requirePermission("COMMANDS");
  const commandId = Number((await params).id);
  const { erro, busca = "" } = await searchParams;
  const commandResult = await query<{ id: number; command_number: number; table_display: string; customer_name: string | null; opened_at: string; notes: string | null; status: string;priority:boolean;priority_note:string|null }>(`SELECT c.id,c.command_number,tl.display_label AS table_display,c.customer_name,c.opened_at,c.notes,c.status,c.priority,c.priority_note FROM commands c JOIN table_locations tl ON tl.table_id=c.table_id WHERE c.id=$1`, [commandId]);
  const command = commandResult.rows[0]; if (!command) notFound();
  const [items, products] = await Promise.all([
    query<{ id: number; product_name: string; quantity: number|string; unit_price_cents: number; status: string; destination: string;sale_unit:string }>("SELECT id,product_name,quantity,unit_price_cents,status,destination,sale_unit FROM order_items WHERE command_id=$1 ORDER BY created_at DESC", [commandId]),
    query<{ id: number; name: string; category: string; price_cents: number; stock_quantity: number|string; destination: string; sale_unit:string; has_image:boolean; image_updated_at:string|null }>(`SELECT id,name,category,price_cents,stock_quantity,destination,sale_unit,(image_data IS NOT NULL) AS has_image,image_updated_at FROM products WHERE active=TRUE AND ($1='' OR name ILIKE '%'||$1||'%' OR category ILIKE '%'||$1||'%') ORDER BY category,name LIMIT 80`, [busca]),
  ]);
  const activeItems = items.rows.filter((item) => item.status !== "CANCELLED");
  const subtotal = Math.round(activeItems.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0));
  const hasPrepPending = activeItems.some((item) => item.status === "PENDING" && item.destination !== "DIRECT");
  const statusLabel: Record<string,string> = { PENDING:"Novo",SENT:"Enviado",PREPARING:"Preparando",READY:"Pronto",DELIVERED:"Entregue",CANCELLED:"Removido" };
  return (
    <>
      <div className="page-head"><div><p className="eyebrow">{command.table_display}</p><h2>Comanda #{command.command_number}</h2><p>{command.customer_name || "Cliente não informado"} · Aberta em {formatDateTime(command.opened_at)}</p></div><div className="actions">{command.priority&&<span className="badge badge-red">Prioridade <PriorityInfo note={command.priority_note}/></span>}<span className={`badge ${command.status === "OPEN" ? "badge-green" : command.status === "CANCELLED" ? "badge-red" : "badge-gray"}`}>{command.status === "OPEN" ? "Aberta" : command.status === "CANCELLED" ? "Cancelada" : "Finalizada"}</span></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="split-layout">
        <section className="card">
          <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Adicionar produtos</h3><p>{products.rows.length} produto(s) encontrado(s)</p></div></div>
          <form method="get" className="actions" style={{ marginBottom: 16 }}><input className="input" name="busca" defaultValue={busca} placeholder="Buscar produto ou categoria" style={{ maxWidth: 340 }}/><button className="btn btn-light" type="submit">Buscar</button></form>
          <div className="product-list">
            {products.rows.map((product) => <form action={addItemAction} className="product-button product-add-card" key={product.id}>
              <input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="productId" value={product.id}/>
              {product.has_image ? <Image className="command-product-photo" src={`/api/products/${product.id}/image?v=${encodeURIComponent(product.image_updated_at ?? "1")}`} alt={product.name} width={220} height={120} unoptimized/> : <span className="command-product-photo command-product-photo-empty"><ImageIcon size={24}/></span>}
              <strong>{product.name}</strong><small>{product.category} · Estoque {formatQuantity(product.stock_quantity,product.sale_unit)}</small><div className="money" style={{ marginTop: 10 }}>{formatMoney(product.price_cents)}</div>
              <div className="product-quantity-row"><input className="input" aria-label={`Quantidade de ${product.name}`} name="quantity" type="number" min={["KG","L"].includes(product.sale_unit) ? "0.001" : "1"} max={String(product.stock_quantity)} step={["KG","L"].includes(product.sale_unit) ? "0.001" : "1"} defaultValue="1" required/><button className="btn btn-primary btn-small" type="submit" disabled={command.status !== "OPEN" || Number(product.stock_quantity) <= 0}>Adicionar</button></div>
            </form>)}
          </div>
        </section>
        <aside className={`card sticky-card ${command.priority ? "priority-alert" : ""}`}>
          {command.status === "OPEN" && <><h3><CircleAlert size={17}/> Prioridade da comanda/mesa</h3>
            {command.priority ? <div className="form-stack priority-control"><div className="priority-current"><strong>Prioridade ativa</strong><PriorityInfo note={command.priority_note}/><p>{command.priority_note}</p></div><form action={updateCommandPriorityAction} className="form-stack"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} defaultValue={command.priority_note??""} rows={3} required/></div><button className="btn btn-primary btn-small" type="submit">Atualizar prioridade</button></form><form action={updateCommandPriorityAction}><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="false"/><button className="btn btn-light btn-small" type="submit">Remover prioridade</button></form></div> : <form action={updateCommandPriorityAction} className="form-stack priority-control"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><div className="field"><label>Motivo ou observação</label><textarea className="textarea" name="priorityNote" minLength={3} rows={3} placeholder="Ex.: cliente aguardando item atrasado" required/></div><button className="btn btn-danger" type="submit"><CircleAlert size={16}/> Marcar como prioridade</button></form>}
            <div className="divider"/></>}
          <h3><ShoppingCart size={17}/> Itens da comanda</h3>
          {activeItems.length === 0 ? <div className="empty" style={{ padding: "28px 12px" }}>Adicione o primeiro produto.</div> : <div className="form-stack">
            {activeItems.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 11 }}>
              <div><strong>{formatQuantity(item.quantity,item.sale_unit)} · {item.product_name}</strong><div style={{ marginTop: 5 }}><span className={`badge ${item.status === "PENDING" ? "badge-amber" : item.status === "READY" ? "badge-green" : "badge-blue"}`}>{statusLabel[item.status]}</span></div></div>
              <div style={{ textAlign: "right" }}><span className="money">{formatMoney(item.unit_price_cents * Number(item.quantity))}</span>{command.status === "OPEN" && <form action={removeItemAction} style={{ marginTop: 6 }}><input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="itemId" value={item.id}/><button className="btn btn-danger btn-small" type="submit" title="Remover item"><MinusCircle size={14}/></button></form>}</div>
            </div>)}
          </div>}
          <div className="divider"/><div className="total-row grand"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          {command.status === "OPEN" && <>
            <div className="divider"/>
            <form action={sendKitchenAction} target="_blank" className="form-stack">
              <input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Formato do pedido</label><select className="select" name="format" defaultValue="80"><option value="80">Térmica 80 mm</option><option value="58">Térmica 58 mm</option><option value="a4">Folha A4</option></select></div>
              <button className="btn btn-dark" type="submit" disabled={!hasPrepPending}><Send size={16}/> Enviar e imprimir cozinha</button>
            </form>
            <div className="divider"/>
            <h3>Fechar comanda</h3>
            <PaymentForm commandId={commandId} subtotal={subtotal}/>
            <div className="divider"/>
            <details className="cancel-command"><summary>Cancelar esta comanda</summary><form action={cancelCommandAction} className="form-stack"><input type="hidden" name="commandId" value={commandId}/><div className="field"><label>Motivo do cancelamento</label><input className="input" name="reason" minLength={3} required/></div><button className="btn btn-danger" type="submit"><XCircle size={16}/> Cancelar comanda e devolver itens ao estoque</button></form></details>
          </>}
        </aside>
      </div>
    </>
  );
}
