"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireRole } from "@/lib/auth";
import { query, transaction } from "@/lib/db";

const operatorRoles = ["ADMIN", "MANAGER", "CASHIER"] as const;
const managerRoles = ["ADMIN", "MANAGER"] as const;

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function cents(value: FormDataEntryValue | null) { return Math.max(0, Math.round(numberValue(value) * 100)); }
function positiveId(value: FormDataEntryValue | null) { const id = Math.trunc(numberValue(value)); if (id < 1) throw new Error("Registro inválido."); return id; }
function fail(path: string, message: string): never { redirect(`${path}${path.includes("?") ? "&" : "?"}erro=${encodeURIComponent(message)}`); }

export async function openCashAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  try {
    await query("INSERT INTO cash_sessions (opened_by, opening_amount_cents) VALUES ($1,$2)", [user.id, cents(formData.get("openingAmount"))]);
  } catch { fail("/caixa", "Já existe um caixa aberto."); }
  revalidatePath("/caixa"); redirect("/caixa");
}

export async function closeCashAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const cashId = positiveId(formData.get("cashId"));
  const format = String(formData.get("format") ?? "80");
  const openCommands = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM commands WHERE status = 'OPEN'");
  if (Number(openCommands.rows[0]?.count) > 0) fail("/caixa", "Feche as comandas abertas antes de encerrar o caixa.");
  const totals = await query<{ cash_total: string }>(
    `SELECT COALESCE(SUM(p.amount_cents),0)::text AS cash_total FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$1 AND s.status='COMPLETED' AND p.method='CASH'`, [cashId],
  );
  const current = await query<{ opening_amount_cents: number }>("SELECT opening_amount_cents FROM cash_sessions WHERE id=$1 AND status='OPEN'", [cashId]);
  if (!current.rows[0]) fail("/caixa", "Caixa não encontrado ou já fechado.");
  const expected = Number(current.rows[0].opening_amount_cents) + Number(totals.rows[0]?.cash_total ?? 0);
  await query("UPDATE cash_sessions SET status='CLOSED', closed_by=$1, closed_at=NOW(), closing_amount_cents=$2, expected_amount_cents=$3, notes=$4 WHERE id=$5 AND status='OPEN'", [user.id, cents(formData.get("closingAmount")), expected, String(formData.get("notes") ?? "").trim() || null, cashId]);
  revalidatePath("/caixa"); redirect(`/imprimir/caixa/${cashId}?formato=${encodeURIComponent(format)}`);
}

export async function openCommandAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const commandNumber = Math.trunc(numberValue(formData.get("commandNumber")));
  const tableId = positiveId(formData.get("tableId"));
  if (commandNumber < 1) fail("/comandas", "Informe um número de comanda válido.");
  try {
    const created = await query<{ id: number }>("INSERT INTO commands (command_number, table_id, customer_name, opened_by, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id", [commandNumber, tableId, String(formData.get("customerName") ?? "").trim() || null, user.id, String(formData.get("notes") ?? "").trim() || null]);
    redirect(`/comandas/${created.rows[0].id}`);
  } catch { fail("/comandas", "Esse número de comanda já está em uso."); }
}

export async function addItemAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const commandId = positiveId(formData.get("commandId"));
  const productId = positiveId(formData.get("productId"));
  const quantity = Math.max(1, Math.trunc(numberValue(formData.get("quantity"), 1)));
  try {
    await transaction(async (client) => {
      const command = await client.query("SELECT id FROM commands WHERE id=$1 AND status='OPEN' FOR UPDATE", [commandId]);
      if (!command.rowCount) throw new Error("Comanda fechada.");
      const product = await client.query<{ name: string; price_cents: number; stock_quantity: number; destination: string }>("SELECT name,price_cents,stock_quantity,destination FROM products WHERE id=$1 AND active=TRUE FOR UPDATE", [productId]);
      const item = product.rows[0];
      if (!item) throw new Error("Produto indisponível.");
      if (Number(item.stock_quantity) < quantity) throw new Error(`Estoque insuficiente. Disponível: ${item.stock_quantity}.`);
      const inserted = await client.query<{ id: number }>("INSERT INTO order_items (command_id,product_id,product_name,unit_price_cents,quantity,destination,added_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [commandId, productId, item.name, item.price_cents, quantity, item.destination, user.id]);
      await client.query("UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2", [quantity, productId]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'ITEM_ADDED',$3,$4)", [productId, -quantity, inserted.rows[0].id, user.id]);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível adicionar o item."); }
  revalidatePath(`/comandas/${commandId}`); revalidatePath("/estoque"); redirect(`/comandas/${commandId}`);
}

export async function removeItemAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const commandId = positiveId(formData.get("commandId"));
  const itemId = positiveId(formData.get("itemId"));
  try {
    await transaction(async (client) => {
      const item = await client.query<{ product_id: number; quantity: number; status: string }>("SELECT oi.product_id,oi.quantity,oi.status FROM order_items oi JOIN commands c ON c.id=oi.command_id WHERE oi.id=$1 AND oi.command_id=$2 AND c.status='OPEN' FOR UPDATE", [itemId, commandId]);
      const current = item.rows[0];
      if (!current || current.status === "CANCELLED") throw new Error("Item não pode ser removido.");
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1", [itemId]);
      await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [current.quantity, current.product_id]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'ITEM_REMOVED',$3,$4)", [current.product_id, current.quantity, itemId, user.id]);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível remover o item."); }
  revalidatePath(`/comandas/${commandId}`); revalidatePath("/estoque"); redirect(`/comandas/${commandId}`);
}

export async function sendKitchenAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const commandId = positiveId(formData.get("commandId"));
  const format = String(formData.get("format") ?? "80");
  let ticketId = 0;
  try {
    ticketId = await transaction(async (client) => {
      const items = await client.query<{ id: number }>("SELECT id FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination IN ('KITCHEN','BAR') FOR UPDATE", [commandId]);
      if (!items.rowCount) throw new Error("Não há novos itens para enviar.");
      const ticket = await client.query<{ id: number }>("INSERT INTO kitchen_tickets (command_id,created_by) VALUES ($1,$2) RETURNING id", [commandId, user.id]);
      const id = ticket.rows[0].id;
      for (const item of items.rows) await client.query("INSERT INTO kitchen_ticket_items (ticket_id,order_item_id) VALUES ($1,$2)", [id, item.id]);
      await client.query("UPDATE order_items SET status='SENT',sent_at=NOW() WHERE id = ANY($1::bigint[])", [items.rows.map((item) => item.id)]);
      return id;
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível enviar o pedido."); }
  revalidatePath(`/comandas/${commandId}`); revalidatePath("/cozinha"); redirect(`/imprimir/cozinha/${ticketId}?formato=${encodeURIComponent(format)}`);
}

export async function updateKitchenStatusAction(formData: FormData) {
  await requireRole(["ADMIN", "MANAGER", "KITCHEN"]);
  const itemId = positiveId(formData.get("itemId"));
  const status = String(formData.get("status") ?? "");
  if (!["PREPARING","READY","DELIVERED"].includes(status)) throw new Error("Situação inválida.");
  await query("UPDATE order_items SET status=$1 WHERE id=$2 AND status<>'CANCELLED'", [status, itemId]);
  revalidatePath("/cozinha");
}

export async function closeCommandAction(formData: FormData) {
  const user = await requireRole([...operatorRoles]);
  const commandId = positiveId(formData.get("commandId"));
  const format = String(formData.get("format") ?? "80");
  const paymentValues = [
    ["CASH", cents(formData.get("cash"))], ["PIX", cents(formData.get("pix"))],
    ["DEBIT", cents(formData.get("debit"))], ["CREDIT", cents(formData.get("credit"))],
  ] as const;
  let saleId = 0;
  try {
    saleId = await transaction(async (client) => {
      const command = await client.query("SELECT id FROM commands WHERE id=$1 AND status='OPEN' FOR UPDATE", [commandId]);
      if (!command.rowCount) throw new Error("Comanda não está aberta.");
      const pending = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination IN ('KITCHEN','BAR')", [commandId]);
      if (Number(pending.rows[0]?.count) > 0) throw new Error("Envie os novos itens para a cozinha antes de fechar.");
      const totalItems = await client.query<{ subtotal: string }>("SELECT COALESCE(SUM(unit_price_cents*quantity),0)::text AS subtotal FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      const subtotal = Number(totalItems.rows[0]?.subtotal ?? 0);
      if (subtotal <= 0) throw new Error("A comanda não possui itens.");
      const discount = Math.min(cents(formData.get("discount")), subtotal);
      const servicePercent = Math.min(100, Math.max(0, numberValue(formData.get("servicePercent"))));
      const service = Math.round((subtotal - discount) * servicePercent / 100);
      const total = subtotal - discount + service;
      const paid = paymentValues.reduce((sum, [, amount]) => sum + amount, 0);
      if (paid !== total) throw new Error("A soma das formas de pagamento precisa ser igual ao total da conta.");
      const cashReceived = cents(formData.get("cashReceived"));
      const cashAmount = paymentValues[0][1];
      if (cashAmount > 0 && cashReceived < cashAmount) throw new Error("O valor recebido em dinheiro é menor que o valor informado.");
      const cash = await client.query<{ id: number }>("SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1 FOR UPDATE");
      if (!cash.rows[0]) throw new Error("Abra o caixa antes de finalizar a venda.");
      const sale = await client.query<{ id: number }>("INSERT INTO sales (command_id,cash_session_id,subtotal_cents,discount_cents,service_fee_cents,total_cents,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [commandId, cash.rows[0].id, subtotal, discount, service, total, user.id]);
      for (const [method, amount] of paymentValues) if (amount > 0) await client.query("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents) VALUES ($1,$2,$3,$4,$5)", [sale.rows[0].id, method, amount, method === "CASH" ? cashReceived : null, method === "CASH" ? cashReceived - amount : 0]);
      await client.query("UPDATE commands SET status='CLOSED',closed_at=NOW() WHERE id=$1", [commandId]);
      return sale.rows[0].id;
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível fechar a comanda."); }
  revalidatePath("/comandas"); revalidatePath("/caixa"); revalidatePath("/painel"); redirect(`/imprimir/venda/${saleId}?formato=${encodeURIComponent(format)}`);
}

export async function createProductAction(formData: FormData) {
  await requireRole([...managerRoles]);
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const destination = String(formData.get("destination") ?? "DIRECT");
  if (!name || !category || !["KITCHEN","BAR","DIRECT"].includes(destination)) fail("/produtos", "Preencha os dados do produto.");
  await query("INSERT INTO products (name,category,price_cents,stock_quantity,min_stock,destination) VALUES ($1,$2,$3,$4,$5,$6)", [name, category, cents(formData.get("price")), Math.max(0,Math.trunc(numberValue(formData.get("stock")))), Math.max(0,Math.trunc(numberValue(formData.get("minStock")))), destination]);
  revalidatePath("/produtos"); revalidatePath("/estoque"); redirect("/produtos");
}

export async function adjustStockAction(formData: FormData) {
  const user = await requireRole([...managerRoles]);
  const productId = positiveId(formData.get("productId"));
  const quantity = Math.trunc(numberValue(formData.get("quantity")));
  if (quantity === 0) fail("/estoque", "Informe uma quantidade diferente de zero.");
  await transaction(async (client) => {
    const current = await client.query<{ stock_quantity: number }>("SELECT stock_quantity FROM products WHERE id=$1 FOR UPDATE", [productId]);
    if (!current.rows[0] || Number(current.rows[0].stock_quantity) + quantity < 0) throw new Error("O ajuste deixaria o estoque negativo.");
    await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [quantity, productId]);
    await client.query("INSERT INTO stock_movements (product_id,quantity,reason,user_id) VALUES ($1,$2,'MANUAL_ADJUSTMENT',$3)", [productId, quantity, user.id]);
  }).catch((error) => fail("/estoque", error instanceof Error ? error.message : "Não foi possível ajustar o estoque."));
  revalidatePath("/estoque"); redirect("/estoque");
}

export async function createTableAction(formData: FormData) {
  await requireRole(["ADMIN"]);
  const number = Math.trunc(numberValue(formData.get("number")));
  if (number < 1) fail("/configuracoes", "Informe o número da mesa.");
  try { await query("INSERT INTO bar_tables (number,label) VALUES ($1,$2)", [number, String(formData.get("label") ?? "").trim() || `Mesa ${number}`]); }
  catch { fail("/configuracoes", "Essa mesa já está cadastrada."); }
  revalidatePath("/configuracoes"); redirect("/configuracoes");
}

export async function createUserAction(formData: FormData) {
  await requireRole(["ADMIN"]);
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");
  if (name.length < 2 || username.length < 3 || password.length < 8 || !["ADMIN","MANAGER","CASHIER","KITCHEN"].includes(role)) fail("/configuracoes", "Revise os dados do funcionário.");
  try { await query("INSERT INTO users (name,username,password_hash,role) VALUES ($1,$2,$3,$4)", [name, username, await hashPassword(password), role]); }
  catch { fail("/configuracoes", "Esse usuário já existe."); }
  revalidatePath("/configuracoes"); redirect("/configuracoes");
}

export async function cancelSaleAction(formData: FormData) {
  const user = await requireRole([...managerRoles]);
  const saleId = positiveId(formData.get("saleId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 4) fail("/relatorios", "Informe o motivo do cancelamento.");
  await transaction(async (client) => {
    const sale = await client.query<{ command_id: number; status: string }>("SELECT command_id,status FROM sales WHERE id=$1 FOR UPDATE", [saleId]);
    if (!sale.rows[0] || sale.rows[0].status !== "COMPLETED") throw new Error("Venda não pode ser cancelada.");
    const items = await client.query<{ id: number; product_id: number; quantity: number }>("SELECT id,product_id,quantity FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [sale.rows[0].command_id]);
    for (const item of items.rows) {
      await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.quantity, item.product_id]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'SALE_CANCELLED',$3,$4)", [item.product_id, item.quantity, item.id, user.id]);
    }
    await client.query("UPDATE sales SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),cancellation_reason=$2 WHERE id=$3", [user.id, reason, saleId]);
    await client.query("UPDATE commands SET status='CANCELLED' WHERE id=$1", [sale.rows[0].command_id]);
  }).catch((error) => fail("/relatorios", error instanceof Error ? error.message : "Não foi possível cancelar a venda."));
  revalidatePath("/relatorios"); revalidatePath("/estoque"); revalidatePath("/caixa"); redirect("/relatorios");
}
