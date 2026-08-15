import { notFound } from "next/navigation";
import { MinusCircle, Send, ShoppingCart } from "lucide-react";
import { addItemAction, removeItemAction, sendKitchenAction } from "@/app/system-actions";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PaymentForm } from "@/components/payment-form";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; busca?: string }> };

export default async function CommandDetailPage({ params, searchParams }: Params) {
  await requirePermission("COMMANDS");
  const commandId = Number((await params).id);
  const { erro, busca = "" } = await searchParams;
  const commandResult = await query<{ id: number; command_number: number; table_number: number; customer_name: string | null; opened_at: string; notes: string | null; status: string }>(`SELECT c.id,c.command_number,t.number AS table_number,c.customer_name,c.opened_at,c.notes,c.status FROM commands c JOIN bar_tables t ON t.id=c.table_id WHERE c.id=$1`, [commandId]);
  const command = commandResult.rows[0]; if (!command) notFound();
  const [items, products] = await Promise.all([
    query<{ id: number; product_name: string; quantity: number; unit_price_cents: number; status: string; destination: string }>("SELECT id,product_name,quantity,unit_price_cents,status,destination FROM order_items WHERE command_id=$1 ORDER BY created_at DESC", [commandId]),
    query<{ id: number; name: string; category: string; price_cents: number; stock_quantity: number; destination: string }>(`SELECT id,name,category,price_cents,stock_quantity,destination FROM products WHERE active=TRUE AND ($1='' OR name ILIKE '%'||$1||'%' OR category ILIKE '%'||$1||'%') ORDER BY category,name LIMIT 80`, [busca]),
  ]);
  const activeItems = items.rows.filter((item) => item.status !== "CANCELLED");
  const subtotal = activeItems.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0);
  const hasPrepPending = activeItems.some((item) => item.status === "PENDING" && item.destination !== "DIRECT");
  const statusLabel: Record<string,string> = { PENDING:"Novo",SENT:"Enviado",PREPARING:"Preparando",READY:"Pronto",DELIVERED:"Entregue",CANCELLED:"Removido" };
  return (
    <>
      <div className="page-head"><div><p className="eyebrow">Mesa {command.table_number}</p><h2>Comanda #{command.command_number}</h2><p>{command.customer_name || "Cliente não informado"} · Aberta em {formatDateTime(command.opened_at)}</p></div><span className={`badge ${command.status === "OPEN" ? "badge-green" : "badge-gray"}`}>{command.status === "OPEN" ? "Aberta" : "Finalizada"}</span></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="split-layout">
        <section className="card">
          <div className="page-head" style={{ marginBottom: 14 }}><div><h3 style={{ margin: 0 }}>Adicionar produtos</h3><p>{products.rows.length} produto(s) encontrado(s)</p></div></div>
          <form method="get" className="actions" style={{ marginBottom: 16 }}><input className="input" name="busca" defaultValue={busca} placeholder="Buscar produto ou categoria" style={{ maxWidth: 340 }}/><button className="btn btn-light" type="submit">Buscar</button></form>
          <div className="product-list">
            {products.rows.map((product) => <form action={addItemAction} key={product.id}>
              <input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="quantity" value="1"/>
              <button className="product-button" type="submit" disabled={command.status !== "OPEN" || Number(product.stock_quantity) < 1} style={{ width: "100%" }}>
                <strong>{product.name}</strong><small>{product.category} · Estoque {product.stock_quantity}</small><div className="money" style={{ marginTop: 10 }}>{formatMoney(product.price_cents)}</div>
              </button>
            </form>)}
          </div>
        </section>
        <aside className="card sticky-card">
          <h3><ShoppingCart size={17}/> Itens da comanda</h3>
          {activeItems.length === 0 ? <div className="empty" style={{ padding: "28px 12px" }}>Adicione o primeiro produto.</div> : <div className="form-stack">
            {activeItems.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 11 }}>
              <div><strong>{item.quantity}× {item.product_name}</strong><div style={{ marginTop: 5 }}><span className={`badge ${item.status === "PENDING" ? "badge-amber" : item.status === "READY" ? "badge-green" : "badge-blue"}`}>{statusLabel[item.status]}</span></div></div>
              <div style={{ textAlign: "right" }}><span className="money">{formatMoney(item.unit_price_cents * item.quantity)}</span>{command.status === "OPEN" && <form action={removeItemAction} style={{ marginTop: 6 }}><input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="itemId" value={item.id}/><button className="btn btn-danger btn-small" type="submit" title="Remover item"><MinusCircle size={14}/></button></form>}</div>
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
          </>}
        </aside>
      </div>
    </>
  );
}
