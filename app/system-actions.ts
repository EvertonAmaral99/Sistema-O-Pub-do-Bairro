"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { hashPassword, requirePermission, requireRole } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { defaultPermissionsByRole, isManagementRole, isPermission, permissionConfig, type Role } from "@/lib/roles";

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function cents(value: FormDataEntryValue | null) { return Math.max(0, Math.round(numberValue(value) * 100)); }
function quantityValue(value: FormDataEntryValue | null, fallback = 0) {
  return Math.round(numberValue(value, fallback) * 1000) / 1000;
}
function positiveId(value: FormDataEntryValue | null) {
  const id = Math.trunc(numberValue(value));
  if (id < 1) throw new Error("Registro inválido.");
  return id;
}
function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}erro=${encodeURIComponent(message)}`);
}
function moneyText(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export async function openCashAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const openingAmount = cents(formData.get("openingAmount"));
  try {
    await transaction(async (client) => {
      const created = await client.query<{ id: number }>("INSERT INTO cash_sessions (opened_by,opening_amount_cents) VALUES ($1,$2) RETURNING id", [user.id, openingAmount]);
      await auditLog({ userId:user.id, action:"CASH_OPENED", entityType:"CASH", entityId:created.rows[0].id, description:`Abriu o caixa com ${moneyText(openingAmount)}.` }, client);
    });
  } catch { fail("/caixa", "Já existe um caixa aberto."); }
  revalidatePath("/caixa");
  redirect("/caixa");
}

export async function closeCashAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const cashId = positiveId(formData.get("cashId"));
  const format = String(formData.get("format") ?? "80");
  const closingAmount = cents(formData.get("closingAmount"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  try {
    await transaction(async (client) => {
      const openCommands = await client.query<{ count:string }>("SELECT COUNT(*)::text AS count FROM commands WHERE status='OPEN'");
      if (Number(openCommands.rows[0]?.count) > 0) throw new Error("Feche as comandas abertas antes de encerrar o caixa.");
      const totals = await client.query<{ cash_total:string }>(`SELECT COALESCE(SUM(p.amount_cents),0)::text AS cash_total FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$1 AND s.status='COMPLETED' AND p.method='CASH'`, [cashId]);
      const current = await client.query<{ opening_amount_cents:number }>("SELECT opening_amount_cents FROM cash_sessions WHERE id=$1 AND status='OPEN' FOR UPDATE", [cashId]);
      if (!current.rows[0]) throw new Error("Caixa não encontrado ou já fechado.");
      const expected = Number(current.rows[0].opening_amount_cents) + Number(totals.rows[0]?.cash_total ?? 0);
      await client.query("UPDATE cash_sessions SET status='CLOSED',closed_by=$1,closed_at=NOW(),closing_amount_cents=$2,expected_amount_cents=$3,notes=$4 WHERE id=$5 AND status='OPEN'", [user.id, closingAmount, expected, notes, cashId]);
      await auditLog({ userId:user.id, action:"CASH_CLOSED", entityType:"CASH", entityId:cashId, description:`Fechou o caixa. Contado: ${moneyText(closingAmount)}; esperado: ${moneyText(expected)}.`, metadata:{ closingAmount, expected } }, client);
    });
  } catch (error) { fail("/caixa", error instanceof Error ? error.message : "Não foi possível fechar o caixa."); }
  revalidatePath("/caixa");
  redirect(`/imprimir/caixa/${cashId}?formato=${encodeURIComponent(format)}`);
}

export async function openCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandNumber = Math.trunc(numberValue(formData.get("commandNumber")));
  const tableId = positiveId(formData.get("tableId"));
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (commandNumber < 1) fail("/comandas", "Informe um número de comanda válido.");
  let commandId = 0;
  try {
    commandId = await transaction(async (client) => {
      const table = await client.query<{ number:number }>("SELECT number FROM bar_tables WHERE id=$1 AND active=TRUE", [tableId]);
      if (!table.rows[0]) throw new Error("Mesa indisponível.");
      const created = await client.query<{ id:number }>("INSERT INTO commands (command_number,table_id,customer_name,opened_by,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id", [commandNumber, tableId, customerName, user.id, notes]);
      await auditLog({ userId:user.id, action:"COMMAND_OPENED", entityType:"COMMAND", entityId:created.rows[0].id, description:`Abriu a comanda #${commandNumber} na mesa ${table.rows[0].number}.` }, client);
      return created.rows[0].id;
    });
  } catch (error) {
    fail("/comandas", error instanceof Error && error.message === "Mesa indisponível." ? error.message : "Esse número de comanda já está em uso.");
  }
  redirect(`/comandas/${commandId}`);
}

export async function addItemAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const productId = positiveId(formData.get("productId"));
  const quantity = quantityValue(formData.get("quantity"), 1);
  if (quantity <= 0) fail(`/comandas/${commandId}`, "Informe uma quantidade maior que zero.");
  try {
    await transaction(async (client) => {
      const command = await client.query<{ command_number:number }>("SELECT command_number FROM commands WHERE id=$1 AND status='OPEN' FOR UPDATE", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const product = await client.query<{ name:string;price_cents:number;stock_quantity:number|string;destination:string;sale_unit:string }>("SELECT name,price_cents,stock_quantity,destination,sale_unit FROM products WHERE id=$1 AND active=TRUE FOR UPDATE", [productId]);
      const item = product.rows[0];
      if (!item) throw new Error("Produto indisponível.");
      if (Number(item.stock_quantity) < quantity) throw new Error(`Estoque insuficiente. Disponível: ${item.stock_quantity}.`);
      const inserted = await client.query<{ id:number }>("INSERT INTO order_items (command_id,product_id,product_name,unit_price_cents,quantity,destination,sale_unit,added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [commandId, productId, item.name, item.price_cents, quantity, item.destination, item.sale_unit, user.id]);
      await client.query("UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2", [quantity, productId]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'ITEM_ADDED',$3,$4)", [productId, -quantity, inserted.rows[0].id, user.id]);
      await auditLog({ userId:user.id, action:"ITEM_ADDED", entityType:"COMMAND", entityId:commandId, description:`Adicionou ${quantity}× ${item.name} à comanda #${command.rows[0].command_number}.`, metadata:{ productId, quantity, orderItemId:inserted.rows[0].id } }, client);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível adicionar o item."); }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/estoque");
  redirect(`/comandas/${commandId}`);
}

export async function removeItemAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const itemId = positiveId(formData.get("itemId"));
  try {
    await transaction(async (client) => {
      const item = await client.query<{ product_id:number;product_name:string;quantity:number|string;status:string;command_number:number }>("SELECT oi.product_id,oi.product_name,oi.quantity,oi.status,c.command_number FROM order_items oi JOIN commands c ON c.id=oi.command_id WHERE oi.id=$1 AND oi.command_id=$2 AND c.status='OPEN' FOR UPDATE", [itemId, commandId]);
      const current = item.rows[0];
      if (!current || current.status === "CANCELLED") throw new Error("Item não pode ser removido.");
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1", [itemId]);
      await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [current.quantity, current.product_id]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'ITEM_REMOVED',$3,$4)", [current.product_id, current.quantity, itemId, user.id]);
      await auditLog({ userId:user.id, action:"ITEM_REMOVED", entityType:"COMMAND", entityId:commandId, description:`Removeu ${current.quantity}× ${current.product_name} da comanda #${current.command_number}.`, metadata:{ itemId, productId:current.product_id, quantity:current.quantity } }, client);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível remover o item."); }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/estoque");
  redirect(`/comandas/${commandId}`);
}

export async function sendKitchenAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const format = String(formData.get("format") ?? "80");
  let ticketId = 0;
  try {
    ticketId = await transaction(async (client) => {
      const command = await client.query<{ command_number:number }>("SELECT command_number FROM commands WHERE id=$1 AND status='OPEN'", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const items = await client.query<{ id:number }>("SELECT id FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination IN ('KITCHEN','BAR') FOR UPDATE", [commandId]);
      if (!items.rowCount) throw new Error("Não há novos itens para enviar.");
      const ticket = await client.query<{ id:number }>("INSERT INTO kitchen_tickets (command_id,created_by) VALUES ($1,$2) RETURNING id", [commandId, user.id]);
      const id = ticket.rows[0].id;
      for (const item of items.rows) await client.query("INSERT INTO kitchen_ticket_items (ticket_id,order_item_id) VALUES ($1,$2)", [id, item.id]);
      await client.query("UPDATE order_items SET status='SENT',sent_at=NOW() WHERE id=ANY($1::bigint[])", [items.rows.map((item) => item.id)]);
      await auditLog({ userId:user.id, action:"KITCHEN_SENT", entityType:"KITCHEN_TICKET", entityId:id, description:`Enviou ${items.rowCount} item(ns) da comanda #${command.rows[0].command_number} para produção.`, metadata:{ commandId, itemCount:items.rowCount } }, client);
      return id;
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível enviar o pedido."); }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/cozinha");
  redirect(`/imprimir/cozinha/${ticketId}?formato=${encodeURIComponent(format)}`);
}

export async function updateKitchenStatusAction(formData: FormData) {
  const user = await requirePermission("KITCHEN");
  const itemId = positiveId(formData.get("itemId"));
  const status = String(formData.get("status") ?? "");
  if (!["PREPARING","READY","DELIVERED"].includes(status)) throw new Error("Situação inválida.");
  await transaction(async (client) => {
    const item = await client.query<{ product_name:string;command_number:number }>("SELECT oi.product_name,c.command_number FROM order_items oi JOIN commands c ON c.id=oi.command_id WHERE oi.id=$1 AND oi.status<>'CANCELLED' FOR UPDATE", [itemId]);
    if (!item.rows[0]) throw new Error("Item não encontrado.");
    await client.query("UPDATE order_items SET status=$1 WHERE id=$2", [status, itemId]);
    const labels:Record<string,string> = { PREPARING:"em preparo", READY:"pronto", DELIVERED:"entregue" };
    await auditLog({ userId:user.id, action:"KITCHEN_STATUS_UPDATED", entityType:"ORDER_ITEM", entityId:itemId, description:`Marcou ${item.rows[0].product_name} da comanda #${item.rows[0].command_number} como ${labels[status]}.`, metadata:{ status } }, client);
  });
  revalidatePath("/cozinha");
}

export async function closeCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const format = String(formData.get("format") ?? "80");
  const paymentValues = [["CASH",cents(formData.get("cash"))],["PIX",cents(formData.get("pix"))],["DEBIT",cents(formData.get("debit"))],["CREDIT",cents(formData.get("credit"))],["STAFF_VOUCHER",cents(formData.get("staffVoucher"))]] as const;
  const splitCount = Math.max(1, Math.trunc(numberValue(formData.get("splitCount"), 1)));
  let saleId = 0;
  try {
    saleId = await transaction(async (client) => {
      const command = await client.query<{ command_number:number }>("SELECT command_number FROM commands WHERE id=$1 AND status='OPEN' FOR UPDATE", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda não está aberta.");
      const pending = await client.query<{ count:string }>("SELECT COUNT(*)::text AS count FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination IN ('KITCHEN','BAR')", [commandId]);
      if (Number(pending.rows[0]?.count) > 0) throw new Error("Envie os novos itens para a cozinha antes de fechar.");
      const totalItems = await client.query<{ subtotal:string }>("SELECT COALESCE(SUM(unit_price_cents*quantity),0)::text AS subtotal FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      const subtotal = Math.round(Number(totalItems.rows[0]?.subtotal ?? 0));
      if (subtotal <= 0) throw new Error("A comanda não possui itens.");
      const discount = Math.min(cents(formData.get("discount")), subtotal);
      const servicePercent = Math.min(100, Math.max(0, numberValue(formData.get("servicePercent"))));
      const service = Math.round((subtotal - discount) * servicePercent / 100);
      const total = subtotal - discount + service;
      const paid = paymentValues.reduce((sum,[,amount]) => sum + amount, 0);
      if (paid !== total) throw new Error("A soma das formas de pagamento precisa ser igual ao total da conta.");
      const cashReceived = cents(formData.get("cashReceived"));
      const cashAmount = paymentValues[0][1];
      if (cashAmount > 0 && cashReceived < cashAmount) throw new Error("O valor recebido em dinheiro é menor que o valor informado.");
      const cash = await client.query<{ id:number }>("SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1 FOR UPDATE");
      if (!cash.rows[0]) throw new Error("Abra o caixa antes de finalizar a venda.");
      const sale = await client.query<{ id:number }>("INSERT INTO sales (command_id,cash_session_id,subtotal_cents,discount_cents,service_fee_cents,total_cents,split_count,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [commandId, cash.rows[0].id, subtotal, discount, service, total, splitCount, user.id]);
      for (const [method,amount] of paymentValues) if (amount > 0) await client.query("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents) VALUES ($1,$2,$3,$4,$5)", [sale.rows[0].id, method, amount, method === "CASH" ? cashReceived : null, method === "CASH" ? cashReceived - amount : 0]);
      await client.query("UPDATE commands SET status='CLOSED',closed_at=NOW() WHERE id=$1", [commandId]);
      await auditLog({ userId:user.id, action:"SALE_COMPLETED", entityType:"SALE", entityId:sale.rows[0].id, description:`Finalizou a comanda #${command.rows[0].command_number} por ${moneyText(total)}.`, metadata:{ commandId, subtotal, discount, service, total, splitCount } }, client);
      return sale.rows[0].id;
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível fechar a comanda."); }
  revalidatePath("/comandas");
  revalidatePath("/caixa");
  revalidatePath("/painel");
  redirect(`/imprimir/venda/${saleId}?formato=${encodeURIComponent(format)}`);
}

export async function cancelCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) fail(`/comandas/${commandId}`, "Informe o motivo do cancelamento.");
  try {
    await transaction(async (client) => {
      const command = await client.query<{ command_number:number }>("SELECT command_number FROM commands WHERE id=$1 AND status='OPEN' FOR UPDATE", [commandId]);
      if (!command.rows[0]) throw new Error("A comanda não está aberta.");
      const items = await client.query<{ id:number;product_id:number;quantity:number|string }>("SELECT id,product_id,quantity FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' FOR UPDATE", [commandId]);
      for (const item of items.rows) {
        await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.quantity, item.product_id]);
        await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'COMMAND_CANCELLED',$3,$4)", [item.product_id, item.quantity, item.id, user.id]);
      }
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      await client.query("UPDATE commands SET status='CANCELLED',closed_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3", [user.id, reason, commandId]);
      await auditLog({ userId:user.id, action:"COMMAND_CANCELLED", entityType:"COMMAND", entityId:commandId, description:`Cancelou a comanda #${command.rows[0].command_number}. Motivo: ${reason}`, metadata:{ reason, returnedItems:items.rowCount } }, client);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível cancelar a comanda."); }
  revalidatePath("/comandas");
  revalidatePath("/painel");
  revalidatePath("/estoque");
  redirect("/comandas");
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission("PRODUCTS");
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const destination = String(formData.get("destination") ?? "DIRECT");
  const saleUnit = String(formData.get("saleUnit") ?? "UNIT");
  const price = cents(formData.get("price"));
  const stock = Math.max(0, quantityValue(formData.get("stock")));
  const minStock = Math.max(0, quantityValue(formData.get("minStock")));
  if (!name || !category || !["KITCHEN","BAR","DIRECT"].includes(destination) || !["UNIT","KG","L","PORTION","DOSE","BOTTLE","CAN"].includes(saleUnit)) fail("/produtos", "Preencha os dados do produto.");
  await transaction(async (client) => {
    const created = await client.query<{ id:number }>("INSERT INTO products (name,category,price_cents,stock_quantity,min_stock,destination,sale_unit) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [name, category, price, stock, minStock, destination, saleUnit]);
    await auditLog({ userId:user.id, action:"PRODUCT_CREATED", entityType:"PRODUCT", entityId:created.rows[0].id, description:`Cadastrou o produto ${name} por ${moneyText(price)}.`, metadata:{ category, stock, minStock, destination, saleUnit } }, client);
  });
  revalidatePath("/produtos");
  revalidatePath("/estoque");
  redirect("/produtos");
}

export async function adjustStockAction(formData: FormData) {
  const user = await requirePermission("STOCK");
  const productId = positiveId(formData.get("productId"));
  const quantity = quantityValue(formData.get("quantity"));
  if (quantity === 0) fail("/estoque", "Informe uma quantidade diferente de zero.");
  try {
    await transaction(async (client) => {
      const current = await client.query<{ name:string;stock_quantity:number|string }>("SELECT name,stock_quantity FROM products WHERE id=$1 FOR UPDATE", [productId]);
      if (!current.rows[0] || Number(current.rows[0].stock_quantity) + quantity < 0) throw new Error("O ajuste deixaria o estoque negativo.");
      const newStock = Number(current.rows[0].stock_quantity) + quantity;
      await client.query("UPDATE products SET stock_quantity=$1,updated_at=NOW() WHERE id=$2", [newStock, productId]);
      await client.query("INSERT INTO stock_movements (product_id,quantity,reason,user_id) VALUES ($1,$2,'MANUAL_ADJUSTMENT',$3)", [productId, quantity, user.id]);
      await auditLog({ userId:user.id, action:"STOCK_ADJUSTED", entityType:"PRODUCT", entityId:productId, description:`Ajustou o estoque de ${current.rows[0].name} em ${quantity > 0 ? "+" : ""}${quantity}. Novo saldo: ${newStock}.`, metadata:{ quantity, previousStock:current.rows[0].stock_quantity, newStock } }, client);
    });
  } catch (error) { fail("/estoque", error instanceof Error ? error.message : "Não foi possível ajustar o estoque."); }
  revalidatePath("/estoque");
  redirect("/estoque");
}

export async function createTableAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const number = Math.trunc(numberValue(formData.get("number")));
  const label = String(formData.get("label") ?? "").trim() || `Mesa ${number}`;
  if (number < 1) fail("/configuracoes", "Informe o número da mesa.");
  try {
    await transaction(async (client) => {
      const created = await client.query<{ id:number }>("INSERT INTO bar_tables (number,label) VALUES ($1,$2) RETURNING id", [number, label]);
      await auditLog({ userId:user.id, action:"TABLE_CREATED", entityType:"TABLE", entityId:created.rows[0].id, description:`Cadastrou a mesa ${number} (${label}).` }, client);
    });
  } catch { fail("/configuracoes", "Essa mesa já está cadastrada."); }
  revalidatePath("/configuracoes");
  redirect("/configuracoes");
}

export async function createUserAction(formData: FormData) {
  const actor = await requireRole(["ADMIN","MANAGER"]);
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const roleValue = String(formData.get("role") ?? "");
  const roles:Role[] = ["ADMIN","MANAGER","CASHIER","KITCHEN","WAITER"];
  if (name.length < 2 || username.length < 3 || password.length < 8 || !roles.includes(roleValue as Role)) fail("/configuracoes", "Revise os dados do funcionário.");
  const role = roleValue as Role;
  if (actor.role === "MANAGER" && !["CASHIER","KITCHEN","WAITER"].includes(role)) fail("/configuracoes", "Gerentes podem cadastrar somente Caixa, Cozinha ou Garçom.");
  try {
    await transaction(async (client) => {
      const created = await client.query<{ id:number }>("INSERT INTO users (name,username,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id", [name, username, await hashPassword(password), role]);
      for (const permission of defaultPermissionsByRole[role]) await client.query("INSERT INTO user_permissions (user_id,permission) VALUES ($1,$2) ON CONFLICT DO NOTHING", [created.rows[0].id, permission]);
      await auditLog({ userId:actor.id, action:"USER_CREATED", entityType:"USER", entityId:created.rows[0].id, description:`Cadastrou o funcionário ${name} com perfil ${role}.`, metadata:{ username, role, permissions:defaultPermissionsByRole[role] } }, client);
    });
  } catch { fail("/configuracoes", "Esse usuário já existe."); }
  revalidatePath("/configuracoes");
  redirect("/configuracoes");
}

export async function updateUserPermissionsAction(formData: FormData) {
  const actor = await requireRole(["ADMIN","MANAGER"]);
  const userId = positiveId(formData.get("userId"));
  const selected = [...new Set(formData.getAll("permissions").map(String).filter(isPermission))];
  try {
    await transaction(async (client) => {
      const target = await client.query<{ name:string;role:Role }>("SELECT name,role FROM users WHERE id=$1 AND active=TRUE FOR UPDATE", [userId]);
      if (!target.rows[0]) throw new Error("Funcionário não encontrado.");
      if (target.rows[0].role === "ADMIN") throw new Error("O acesso de Administradores é sempre completo.");
      if (actor.role === "MANAGER" && target.rows[0].role === "MANAGER") throw new Error("Somente Administradores podem alterar outro Gerente.");
      const allowed = isManagementRole(target.rows[0].role) ? selected : selected.filter((permission) => !["CASH","REPORTS"].includes(permission));
      await client.query("DELETE FROM user_permissions WHERE user_id=$1", [userId]);
      for (const permission of allowed) await client.query("INSERT INTO user_permissions (user_id,permission) VALUES ($1,$2)", [userId, permission]);
      const labels = permissionConfig.filter((item) => allowed.includes(item.key)).map((item) => item.label);
      await auditLog({ userId:actor.id, action:"PERMISSIONS_UPDATED", entityType:"USER", entityId:userId, description:`Atualizou os acessos de ${target.rows[0].name}: ${labels.length ? labels.join(", ") : "sem módulos operacionais"}.`, metadata:{ permissions:allowed } }, client);
    });
  } catch (error) { fail("/configuracoes", error instanceof Error ? error.message : "Não foi possível atualizar os acessos."); }
  revalidatePath("/configuracoes");
  redirect("/configuracoes");
}

function eventFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const eventDate = String(formData.get("eventDate") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const durationHours = quantityValue(formData.get("durationHours"));
  const amount = cents(formData.get("amount"));
  if (name.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{2}:\d{2}$/.test(startTime) || durationHours <= 0) {
    throw new Error("Preencha corretamente os dados do evento.");
  }
  return { name, eventDate, startTime, durationHours, amount };
}

export async function createEventAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  let eventDate = "";
  try {
    const fields = eventFields(formData); eventDate = fields.eventDate;
    await transaction(async (client) => {
      const created = await client.query<{ id:number }>("INSERT INTO events (name,event_date,start_time,duration_hours,amount_cents,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [fields.name, fields.eventDate, fields.startTime, fields.durationHours, fields.amount, user.id]);
      await auditLog({ userId:user.id, action:"EVENT_CREATED", entityType:"EVENT", entityId:created.rows[0].id, description:`Cadastrou o evento ${fields.name} para ${fields.eventDate} às ${fields.startTime}.`, metadata:fields }, client);
    });
  } catch (error) { fail(`/agenda/novo${eventDate ? `?data=${eventDate}` : ""}`, error instanceof Error ? error.message : "Não foi possível cadastrar o evento."); }
  revalidatePath("/agenda");
  redirect(`/agenda?mes=${eventDate.slice(0,7)}`);
}

export async function updateEventAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const eventId = positiveId(formData.get("eventId"));
  let eventMonth = "";
  try {
    const fields = eventFields(formData);
    eventMonth = fields.eventDate.slice(0,7);
    await transaction(async (client) => {
      const updated = await client.query("UPDATE events SET name=$1,event_date=$2,start_time=$3,duration_hours=$4,amount_cents=$5,updated_by=$6,updated_at=NOW() WHERE id=$7", [fields.name, fields.eventDate, fields.startTime, fields.durationHours, fields.amount, user.id, eventId]);
      if (!updated.rowCount) throw new Error("Evento não encontrado.");
      await auditLog({ userId:user.id, action:"EVENT_UPDATED", entityType:"EVENT", entityId:eventId, description:`Atualizou o evento ${fields.name} de ${fields.eventDate}.`, metadata:fields }, client);
    });
  } catch (error) { fail(`/agenda/${eventId}`, error instanceof Error ? error.message : "Não foi possível atualizar o evento."); }
  revalidatePath("/agenda");
  redirect(`/agenda?mes=${eventMonth}`);
}

export async function deleteEventAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const eventId = positiveId(formData.get("eventId"));
  try {
    await transaction(async (client) => {
      const removed = await client.query<{ name:string;event_date:string }>("DELETE FROM events WHERE id=$1 RETURNING name,event_date::text", [eventId]);
      if (!removed.rows[0]) throw new Error("Evento não encontrado.");
      await auditLog({ userId:user.id, action:"EVENT_DELETED", entityType:"EVENT", entityId:eventId, description:`Excluiu o evento ${removed.rows[0].name} de ${removed.rows[0].event_date}.` }, client);
    });
  } catch (error) { fail(`/agenda/${eventId}`, error instanceof Error ? error.message : "Não foi possível excluir o evento."); }
  revalidatePath("/agenda");
  redirect("/agenda");
}

export async function cancelSaleAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const saleId = positiveId(formData.get("saleId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 4) fail("/relatorios", "Informe o motivo do cancelamento.");
  try {
    await transaction(async (client) => {
      const sale = await client.query<{ command_id:number;status:string;total_cents:number }>("SELECT command_id,status,total_cents FROM sales WHERE id=$1 FOR UPDATE", [saleId]);
      if (!sale.rows[0] || sale.rows[0].status !== "COMPLETED") throw new Error("Venda não pode ser cancelada.");
      const items = await client.query<{ id:number;product_id:number;quantity:number }>("SELECT id,product_id,quantity FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [sale.rows[0].command_id]);
      for (const item of items.rows) {
        await client.query("UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.quantity, item.product_id]);
        await client.query("INSERT INTO stock_movements (product_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,'SALE_CANCELLED',$3,$4)", [item.product_id, item.quantity, item.id, user.id]);
      }
      await client.query("UPDATE sales SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),cancellation_reason=$2 WHERE id=$3", [user.id, reason, saleId]);
      await client.query("UPDATE commands SET status='CANCELLED' WHERE id=$1", [sale.rows[0].command_id]);
      await auditLog({ userId:user.id, action:"SALE_CANCELLED", entityType:"SALE", entityId:saleId, description:`Cancelou a venda #${saleId} de ${moneyText(Number(sale.rows[0].total_cents))}. Motivo: ${reason}`, metadata:{ reason, commandId:sale.rows[0].command_id } }, client);
    });
  } catch (error) { fail("/relatorios", error instanceof Error ? error.message : "Não foi possível cancelar a venda."); }
  revalidatePath("/relatorios");
  revalidatePath("/estoque");
  revalidatePath("/caixa");
  redirect("/relatorios");
}
