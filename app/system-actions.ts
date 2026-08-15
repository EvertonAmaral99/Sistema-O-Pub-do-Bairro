"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { hashPassword, requirePermission, requireRole, requireUser, verifyPassword } from "@/lib/auth";
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
function productName(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}
function stockPerSaleUnitValue(value: FormDataEntryValue | null, name: string, saleUnit: string) {
  const raw = String(value ?? "").trim();
  if (raw) {
    const manual = quantityValue(value);
    if (manual <= 0) throw new Error("O controle interno deste produto está inválido.");
    return manual;
  }
  if (saleUnit === "L") {
    const milliliters = name.match(/(\d+(?:[.,]\d+)?)\s*ML\b/i)?.[1];
    if (milliliters) return Math.round((Number(milliliters.replace(",", ".")) / 1000) * 1000) / 1000;
  }
  return 1;
}

async function readProductImage(value: FormDataEntryValue | null) {
  if (!value || typeof value === "string" || value.size === 0) return null;
  if (value.size > 3 * 1024 * 1024) throw new Error("A foto deve ter no máximo 3 MB.");
  if (!["image/jpeg","image/png","image/webp"].includes(value.type)) throw new Error("Envie a foto em JPG, PNG ou WebP.");
  const data = Buffer.from(await value.arrayBuffer());
  const jpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length > 8 && data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = data.length > 12 && data.toString("ascii",0,4) === "RIFF" && data.toString("ascii",8,12) === "WEBP";
  if (!(jpeg || png || webp)) throw new Error("O conteúdo do arquivo não corresponde a uma imagem aceita.");
  return { data, mime:value.type };
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
  const tableIds = [...new Set(formData.getAll("tableIds").map((value)=>Math.trunc(numberValue(value))).filter((id)=>id>0))];
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (commandNumber < 1) fail("/comandas", "Informe um número de comanda válido.");
  if (tableIds.length < 1) fail("/comandas", "Selecione ao menos uma mesa para a comanda.");
  let commandId = 0;
  try {
    commandId = await transaction(async (client) => {
      const tables = await client.query<{id:number;label:string;active:boolean}>("SELECT id,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables WHERE id=ANY($1::bigint[]) ORDER BY number FOR UPDATE",[tableIds]);
      if(tables.rows.length!==tableIds.length||tables.rows.some((table)=>!table.active)) throw new Error("Uma das mesas selecionadas está indisponível.");
      const primaryTableId=tables.rows[0].id;
      const created = await client.query<{ id:number }>("INSERT INTO commands (command_number,table_id,customer_name,opened_by,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id", [commandNumber, primaryTableId, customerName, user.id, notes]);
      for(const table of tables.rows) await client.query("INSERT INTO command_tables (command_id,table_id) VALUES ($1,$2)",[created.rows[0].id,table.id]);
      const displayLabel=tables.rows.map((table)=>table.label).join(" + ");
      await auditLog({ userId:user.id, action:"COMMAND_OPENED", entityType:"COMMAND", entityId:created.rows[0].id, description:`Abriu a comanda #${commandNumber} em ${displayLabel}.`, metadata:{ commandNumber, tableIds:tables.rows.map((table)=>table.id), table:displayLabel } }, client);
      return created.rows[0].id;
    });
  } catch (error) {
    const message=error instanceof Error?error.message:"Não foi possível abrir a comanda.";
    fail("/comandas",message.includes("duplicate key")?"Esse número de comanda já está em uso.":message);
  }
  redirect(`/comandas/${commandId}`);
}

export async function updateCommandTablesAction(formData:FormData){
  const user=await requirePermission("COMMANDS");
  const commandId=positiveId(formData.get("commandId"));
  const tableIds=[...new Set(formData.getAll("tableIds").map((value)=>Math.trunc(numberValue(value))).filter((id)=>id>0))];
  if(tableIds.length<1) fail(`/comandas/${commandId}`,"Selecione ao menos uma mesa para a comanda.");
  try{
    await transaction(async(client)=>{
      const command=await client.query<{command_number:number;display_label:string}>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c",[commandId]);
      if(!command.rows[0]) throw new Error("A comanda não está aberta.");
      const tables=await client.query<{id:number;label:string;active:boolean}>("SELECT id,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables WHERE id=ANY($1::bigint[]) ORDER BY number FOR UPDATE",[tableIds]);
      if(tables.rows.length!==tableIds.length||tables.rows.some((table)=>!table.active)) throw new Error("Uma das mesas selecionadas está indisponível.");
      await client.query("DELETE FROM command_tables WHERE command_id=$1",[commandId]);
      for(const table of tables.rows) await client.query("INSERT INTO command_tables (command_id,table_id) VALUES ($1,$2)",[commandId,table.id]);
      await client.query("UPDATE commands SET table_id=$1 WHERE id=$2",[tables.rows[0].id,commandId]);
      const displayLabel=tables.rows.map((table)=>table.label).join(" + ");
      await auditLog({userId:user.id,action:"COMMAND_TABLES_UPDATED",entityType:"COMMAND",entityId:commandId,description:`Alterou as mesas da comanda #${command.rows[0].command_number}: ${command.rows[0].display_label} → ${displayLabel}.`,metadata:{commandNumber:command.rows[0].command_number,previousTables:command.rows[0].display_label,tableIds:tables.rows.map((table)=>table.id),tables:displayLabel}},client);
    });
  }catch(error){fail(`/comandas/${commandId}`,error instanceof Error?error.message:"Não foi possível alterar as mesas da comanda.");}
  revalidatePath(`/comandas/${commandId}`);revalidatePath("/comandas");revalidatePath("/painel");revalidatePath("/cozinha");
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
      const command = await client.query<{ command_number:number;display_label:string }>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const product = await client.query<{ name:string;price_cents:number;stock_pool_id:number;stock_quantity:number|string;stock_unlimited:boolean;destination:string;sale_unit:string;stock_per_sale_unit:number|string }>("SELECT p.name,p.price_cents,p.stock_pool_id,sp.stock_quantity,sp.unlimited AS stock_unlimited,p.destination,p.sale_unit,p.stock_per_sale_unit FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1 AND p.active=TRUE AND p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%' FOR UPDATE OF p,sp", [productId]);
      const item = product.rows[0];
      if (!item) throw new Error("Produto indisponível.");
      const factor = Number(item.stock_per_sale_unit);
      if (!Number.isInteger(quantity)) throw new Error("Os produtos devem ser lançados por unidade.");
      const stockUsed = item.stock_unlimited ? 0 : Math.round(quantity * factor * 1000) / 1000;
      if (!item.stock_unlimited && Number(item.stock_quantity) < stockUsed) throw new Error(`Estoque insuficiente. Disponível: ${item.stock_quantity} ${item.sale_unit}.`);
      const displayUnit = "UNIT";
      const inserted = await client.query<{ id:number }>("INSERT INTO order_items (command_id,product_id,stock_pool_id,product_name,unit_price_cents,quantity,stock_quantity_used,destination,sale_unit,display_unit,added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id", [commandId, productId, item.stock_pool_id, item.name, item.price_cents, quantity, stockUsed, item.destination, item.sale_unit, displayUnit, user.id]);
      if (!item.stock_unlimited) {
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2", [stockUsed, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'ITEM_ADDED',$4,$5)", [productId, item.stock_pool_id, -stockUsed, inserted.rows[0].id, user.id]);
      }
      const stockDetail = item.stock_unlimited ? " Estoque ilimitado." : ` Baixa interna de estoque: ${stockUsed} ${item.sale_unit}.`;
      await auditLog({ userId:user.id, action:"ITEM_ADDED", entityType:"COMMAND", entityId:commandId, description:`Adicionou ${quantity}× ${item.name} à comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}.${stockDetail}`, metadata:{ commandNumber:command.rows[0].command_number, table:command.rows[0].display_label, productId, productName:item.name, quantity, stockPoolId:item.stock_pool_id, stockUsed, stockUnlimited:item.stock_unlimited, stockUnit:item.sale_unit, orderItemId:inserted.rows[0].id } }, client);
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
      const item = await client.query<{ product_id:number;stock_pool_id:number;product_name:string;quantity:number|string;stock_quantity_used:number|string;sale_unit:string;status:string;command_number:number;display_label:string }>("SELECT oi.product_id,oi.stock_pool_id,oi.product_name,oi.quantity,oi.stock_quantity_used,oi.sale_unit,oi.status,c.command_number,cl.display_label FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE oi.id=$1 AND oi.command_id=$2 AND c.status='OPEN' FOR UPDATE OF oi,c", [itemId, commandId]);
      const current = item.rows[0];
      if (!current || current.status === "CANCELLED") throw new Error("Item não pode ser removido.");
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1", [itemId]);
      if (Number(current.stock_quantity_used) > 0) {
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [current.stock_quantity_used, current.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'ITEM_REMOVED',$4,$5)", [current.product_id, current.stock_pool_id, current.stock_quantity_used, itemId, user.id]);
      }
      const returnDetail=Number(current.stock_quantity_used)>0?` Estoque devolvido: ${current.stock_quantity_used} ${current.sale_unit}.`:" Estoque ilimitado, sem alteração de saldo.";
      await auditLog({ userId:user.id, action:"ITEM_REMOVED", entityType:"COMMAND", entityId:commandId, description:`Removeu ${current.quantity}× ${current.product_name} da comanda #${current.command_number}, ${current.display_label}.${returnDetail}`, metadata:{ commandNumber:current.command_number, table:current.display_label, itemId, productId:current.product_id, productName:current.product_name, quantity:current.quantity, stockPoolId:current.stock_pool_id, stockReturned:current.stock_quantity_used, stockUnit:current.sale_unit } }, client);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível remover o item."); }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/estoque");
  redirect(`/comandas/${commandId}`);
}

export async function updateCommandPriorityAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const returnTo = formData.get("returnTo") === "/painel" ? "/painel" : `/comandas/${commandId}`;
  const priority = formData.get("priority") === "true";
  const note = String(formData.get("priorityNote") ?? "").trim();
  if (priority && note.length < 3) fail(returnTo, "Informe o motivo da prioridade.");
  try {
    await transaction(async (client) => {
      const command = await client.query<{ command_number:number;display_label:string }>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("A comanda não está aberta.");
      await client.query("UPDATE commands SET priority=$1,priority_note=$2,priority_updated_at=NOW(),priority_updated_by=$3 WHERE id=$4", [priority, priority ? note : null, user.id, commandId]);
      await auditLog({ userId:user.id, action:priority ? "COMMAND_PRIORITY_SET" : "COMMAND_PRIORITY_REMOVED", entityType:"COMMAND", entityId:commandId, description:priority ? `Marcou a comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}, como prioridade. Motivo: ${note}` : `Removeu a prioridade da comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}.`, metadata:{ commandNumber:command.rows[0].command_number, table:command.rows[0].display_label, priority, note:priority ? note : null } }, client);
    });
  } catch (error) { fail(returnTo, error instanceof Error ? error.message : "Não foi possível alterar a prioridade."); }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/comandas");
  revalidatePath("/cozinha");
  revalidatePath("/painel");
  redirect(returnTo);
}

export async function sendKitchenAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  const format = String(formData.get("format") ?? "80");
  let ticketId = 0;
  try {
    ticketId = await transaction(async (client) => {
      const command = await client.query<{ command_number:number;display_label:string }>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN'", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const items = await client.query<{ id:number }>("SELECT id FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination IN ('KITCHEN','BAR') FOR UPDATE", [commandId]);
      if (!items.rowCount) throw new Error("Não há novos itens para enviar.");
      const ticket = await client.query<{ id:number }>("INSERT INTO kitchen_tickets (command_id,created_by) VALUES ($1,$2) RETURNING id", [commandId, user.id]);
      const id = ticket.rows[0].id;
      for (const item of items.rows) await client.query("INSERT INTO kitchen_ticket_items (ticket_id,order_item_id) VALUES ($1,$2)", [id, item.id]);
      await client.query("UPDATE order_items SET status='SENT',sent_at=NOW() WHERE id=ANY($1::bigint[])", [items.rows.map((item) => item.id)]);
      await auditLog({ userId:user.id, action:"KITCHEN_SENT", entityType:"KITCHEN_TICKET", entityId:id, description:`Enviou ${items.rowCount} item(ns) da comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}, para cozinha/bar.`, metadata:{ commandId, commandNumber:command.rows[0].command_number, table:command.rows[0].display_label, itemCount:items.rowCount } }, client);
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
    const item = await client.query<{ product_name:string;command_number:number;display_label:string }>("SELECT oi.product_name,c.command_number,cl.display_label FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE oi.id=$1 AND oi.status<>'CANCELLED' FOR UPDATE OF oi", [itemId]);
    if (!item.rows[0]) throw new Error("Item não encontrado.");
    await client.query("UPDATE order_items SET status=$1 WHERE id=$2", [status, itemId]);
    const labels:Record<string,string> = { PREPARING:"em preparo", READY:"pronto", DELIVERED:"entregue" };
    await auditLog({ userId:user.id, action:"KITCHEN_STATUS_UPDATED", entityType:"ORDER_ITEM", entityId:itemId, description:`Marcou ${item.rows[0].product_name} da comanda #${item.rows[0].command_number}, ${item.rows[0].display_label}, como ${labels[status]}.`, metadata:{ commandNumber:item.rows[0].command_number, table:item.rows[0].display_label, productName:item.rows[0].product_name, status } }, client);
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
      const command = await client.query<{ command_number:number;display_label:string }>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
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
      const cash = await client.query<{ id:number }>("SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1 FOR UPDATE");
      if (!cash.rows[0]) throw new Error("Abra o caixa antes de finalizar a venda.");
      const sale = await client.query<{ id:number }>("INSERT INTO sales (command_id,cash_session_id,subtotal_cents,discount_cents,service_fee_cents,total_cents,split_count,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [commandId, cash.rows[0].id, subtotal, discount, service, total, splitCount, user.id]);
      for (const [method,amount] of paymentValues) if (amount > 0) await client.query("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents) VALUES ($1,$2,$3,NULL,0)", [sale.rows[0].id, method, amount]);
      await client.query("UPDATE commands SET status='CLOSED',closed_at=NOW() WHERE id=$1", [commandId]);
      await auditLog({ userId:user.id, action:"SALE_COMPLETED", entityType:"SALE", entityId:sale.rows[0].id, description:`Finalizou a comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}, por ${moneyText(total)}.`, metadata:{ commandId, commandNumber:command.rows[0].command_number, table:command.rows[0].display_label, subtotal, discount, service, total, splitCount } }, client);
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
      const command = await client.query<{ command_number:number;display_label:string }>("SELECT c.command_number,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("A comanda não está aberta.");
      const items = await client.query<{ id:number;product_id:number;stock_pool_id:number;stock_quantity_used:number|string }>("SELECT id,product_id,stock_pool_id,stock_quantity_used FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' FOR UPDATE", [commandId]);
      for (const item of items.rows) {
        if (Number(item.stock_quantity_used) <= 0) continue;
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.stock_quantity_used, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'COMMAND_CANCELLED',$4,$5)", [item.product_id, item.stock_pool_id, item.stock_quantity_used, item.id, user.id]);
      }
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      await client.query("UPDATE commands SET status='CANCELLED',closed_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3", [user.id, reason, commandId]);
      await auditLog({ userId:user.id, action:"COMMAND_CANCELLED", entityType:"COMMAND", entityId:commandId, description:`Cancelou a comanda #${command.rows[0].command_number}, ${command.rows[0].display_label}. Motivo: ${reason}`, metadata:{ commandNumber:command.rows[0].command_number, table:command.rows[0].display_label, reason, returnedItems:items.rowCount } }, client);
    });
  } catch (error) { fail(`/comandas/${commandId}`, error instanceof Error ? error.message : "Não foi possível cancelar a comanda."); }
  revalidatePath("/comandas");
  revalidatePath("/painel");
  revalidatePath("/estoque");
  redirect("/comandas");
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission("PRODUCTS");
  const name = productName(formData.get("name"));
  const category = String(formData.get("category") ?? "").trim();
  const destination = String(formData.get("destination") ?? "DIRECT");
  const stockMode = String(formData.get("stockMode") ?? "OWN");
  const isDraft = stockMode === "DRAFT_BEER" || stockMode === "DRAFT_WINE";
  const saleUnit = isDraft ? "L" : String(formData.get("saleUnit") ?? "UNIT");
  const price = cents(formData.get("price"));
  const unlimited = stockMode === "UNLIMITED";
  const stock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("stock")));
  const minStock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("minStock")));
  if (!name || !category || !["OWN","DRAFT_BEER","DRAFT_WINE","UNLIMITED"].includes(stockMode) || !["KITCHEN","BAR","DIRECT"].includes(destination) || !["UNIT","KG","L","PORTION","DOSE","BOTTLE","CAN"].includes(saleUnit)) fail("/produtos", "Preencha os dados do produto.");
  let image:null|{data:Buffer;mime:string}=null;
  let stockPerSaleUnit = 1;
  try {
    if(isDraft){
      const milliliters=Math.trunc(numberValue(formData.get("servingMilliliters")));
      if(![300,500].includes(milliliters)) throw new Error("Escolha o tamanho de 300 ml ou 500 ml.");
      stockPerSaleUnit=milliliters/1000;
    }else stockPerSaleUnit = stockPerSaleUnitValue(formData.get("stockPerSaleUnit"), name, saleUnit);
  }
  catch(error) { fail("/produtos", error instanceof Error ? error.message : "Revise o controle de estoque."); }
  try { image=await readProductImage(formData.get("image")); }
  catch(error){ fail("/produtos",error instanceof Error?error.message:"Não foi possível processar a foto."); }
  try {
    await transaction(async (client) => {
      let stockPoolId:number;
      let effectiveStock=stock;
      let effectiveMinStock=minStock;
      let effectiveUnlimited=unlimited;
      let stockDescription:string;
      if(isDraft){
        const pool=await client.query<{id:number;name:string;stock_quantity:number|string;min_stock:number|string}>("SELECT id,name,stock_quantity,min_stock FROM stock_pools WHERE stock_kind=$1 FOR UPDATE",[stockMode]);
        if(!pool.rows[0]) throw new Error("O estoque de chopp não foi encontrado.");
        stockPoolId=pool.rows[0].id;
        effectiveStock=Number(pool.rows[0].stock_quantity);
        effectiveMinStock=Number(pool.rows[0].min_stock);
        effectiveUnlimited=false;
        stockDescription=` Usa ${pool.rows[0].name}; baixa de ${stockPerSaleUnit} L por unidade.`;
      }else{
        const pool=await client.query<{id:number}>("INSERT INTO stock_pools (name,sale_unit,stock_quantity,min_stock,unlimited) VALUES ($1,$2,$3,$4,$5) RETURNING id",[name,saleUnit,stock,minStock,unlimited]);
        stockPoolId=pool.rows[0].id;
        stockDescription=effectiveUnlimited?" Estoque ilimitado.":` Estoque inicial: ${effectiveStock} ${saleUnit}; mínimo: ${effectiveMinStock} ${saleUnit}.`;
      }
      const created = await client.query<{ id:number }>("INSERT INTO products (name,category,price_cents,stock_quantity,min_stock,destination,sale_unit,stock_per_sale_unit,stock_pool_id,image_data,image_mime,image_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $10::bytea IS NULL THEN NULL ELSE NOW() END) RETURNING id", [name, category, price, effectiveStock, effectiveMinStock, destination, saleUnit, stockPerSaleUnit, stockPoolId, image?.data??null, image?.mime??null]);
      await auditLog({ userId:user.id, action:"PRODUCT_CREATED", entityType:"PRODUCT", entityId:created.rows[0].id, description:`Cadastrou o produto ${name} por ${moneyText(price)}.${stockDescription}`, metadata:{ category, stock:effectiveStock, minStock:effectiveMinStock, unlimited:effectiveUnlimited, stockMode, stockPoolId, destination, saleUnit, stockPerSaleUnit, hasImage:Boolean(image) } }, client);
    });
  } catch(error){ fail("/produtos",error instanceof Error?error.message:"Não foi possível cadastrar o produto."); }
  revalidatePath("/produtos");
  revalidatePath("/estoque");
  redirect("/produtos");
}

export async function updateProductAction(formData: FormData) {
  const user = await requirePermission("PRODUCTS");
  const productId = positiveId(formData.get("productId"));
  const name = productName(formData.get("name"));
  const category = String(formData.get("category") ?? "").trim();
  const destination = String(formData.get("destination") ?? "DIRECT");
  const stockMode = String(formData.get("stockMode") ?? "OWN");
  const isDraft = stockMode === "DRAFT_BEER" || stockMode === "DRAFT_WINE";
  const saleUnit = isDraft ? "L" : String(formData.get("saleUnit") ?? "UNIT");
  const price = cents(formData.get("price"));
  const unlimited = stockMode === "UNLIMITED";
  const stock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("stock")));
  const minStock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("minStock")));
  const active = formData.get("active") === "on";
  const removeImage = formData.get("removeImage") === "on";
  if (!name || !category || !["OWN","DRAFT_BEER","DRAFT_WINE","UNLIMITED"].includes(stockMode) || !["KITCHEN","BAR","DIRECT"].includes(destination) || !["UNIT","KG","L","PORTION","DOSE","BOTTLE","CAN"].includes(saleUnit)) fail(`/produtos/${productId}`, "Revise os dados do produto.");
  let image:null|{data:Buffer;mime:string}=null;
  let stockPerSaleUnit = 1;
  try {
    if(isDraft){
      const milliliters=Math.trunc(numberValue(formData.get("servingMilliliters")));
      if(![300,500].includes(milliliters)) throw new Error("Escolha o tamanho de 300 ml ou 500 ml.");
      stockPerSaleUnit=milliliters/1000;
    }else stockPerSaleUnit = stockPerSaleUnitValue(formData.get("stockPerSaleUnit"), name, saleUnit);
  }
  catch(error) { fail(`/produtos/${productId}`, error instanceof Error ? error.message : "Revise o controle de estoque."); }
  try { image=await readProductImage(formData.get("image")); }
  catch(error){ fail(`/produtos/${productId}`,error instanceof Error?error.message:"Não foi possível processar a foto."); }
  try {
    await transaction(async (client) => {
      const current = await client.query<{name:string;price_cents:number;stock_per_sale_unit:number|string;stock_pool_id:number;stock_kind:string|null;stock_quantity:number|string;min_stock:number|string;stock_unlimited:boolean;stock_sale_unit:string;pool_members:string}>(`SELECT p.name,p.price_cents,p.stock_per_sale_unit,p.stock_pool_id,sp.stock_kind,sp.stock_quantity,sp.min_stock,sp.unlimited AS stock_unlimited,sp.sale_unit AS stock_sale_unit,
        (SELECT COUNT(*)::text FROM products linked WHERE linked.stock_pool_id=p.stock_pool_id AND linked.deleted_at IS NULL) AS pool_members
        FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p,sp`,[productId]);
      if(!current.rows[0]) throw new Error("Produto não encontrado.");
      const old=current.rows[0];
      let stockPoolId=old.stock_pool_id;
      let effectiveStock=stock;
      let effectiveMinStock=minStock;
      let effectiveUnlimited=unlimited;
      let stockDescription:string;
      let updatePool=true;
      if(isDraft){
        const pool=await client.query<{id:number;name:string;stock_quantity:number|string;min_stock:number|string}>("SELECT id,name,stock_quantity,min_stock FROM stock_pools WHERE stock_kind=$1 FOR UPDATE",[stockMode]);
        if(!pool.rows[0]) throw new Error("O estoque de chopp não foi encontrado.");
        stockPoolId=pool.rows[0].id;
        effectiveStock=Number(pool.rows[0].stock_quantity);
        effectiveMinStock=Number(pool.rows[0].min_stock);
        effectiveUnlimited=false;
        updatePool=false;
        stockDescription=` Usa ${pool.rows[0].name}; baixa de ${stockPerSaleUnit} L por unidade.`;
      }else if(Number(old.pool_members)>1||old.stock_kind){
        const pool=await client.query<{id:number}>("INSERT INTO stock_pools (name,sale_unit,stock_quantity,min_stock,unlimited) VALUES ($1,$2,$3,$4,$5) RETURNING id",[name,saleUnit,stock,minStock,unlimited]);
        stockPoolId=pool.rows[0].id;
        updatePool=false;
        stockDescription=effectiveUnlimited?" Estoque ilimitado.":` Estoque ${effectiveStock} ${saleUnit}; mínimo ${effectiveMinStock} ${saleUnit}.`;
      }else{
        stockDescription=effectiveUnlimited?" Estoque ilimitado.":` Estoque ${effectiveStock} ${saleUnit}; mínimo ${effectiveMinStock} ${saleUnit}.`;
      }
      if(updatePool){
        if(Number(old.pool_members)>1&&old.stock_sale_unit!==saleUnit) throw new Error("Separe o estoque antes de alterar a forma de controle deste produto.");
        await client.query("UPDATE stock_pools SET name=CASE WHEN $1::boolean THEN name ELSE $2 END,sale_unit=$3,stock_quantity=$4,min_stock=$5,unlimited=$6,updated_at=NOW() WHERE id=$7",[Number(old.pool_members)>1,name,saleUnit,effectiveStock,effectiveMinStock,effectiveUnlimited,stockPoolId]);
        const difference=Math.round((effectiveStock-Number(old.stock_quantity))*1000)/1000;
        if(!effectiveUnlimited&&difference!==0) await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,user_id) VALUES ($1,$2,$3,'PRODUCT_EDIT',$4)",[productId,stockPoolId,difference,user.id]);
      }
      await client.query(`UPDATE products SET name=$1,category=$2,price_cents=$3,stock_quantity=$4,min_stock=$5,destination=$6,sale_unit=$7,stock_per_sale_unit=$8,stock_pool_id=$9,active=$10,
        image_data=CASE WHEN $11::boolean THEN NULL WHEN $12::bytea IS NOT NULL THEN $12 ELSE image_data END,
        image_mime=CASE WHEN $11::boolean THEN NULL WHEN $12::bytea IS NOT NULL THEN $13 ELSE image_mime END,
        image_updated_at=CASE WHEN $11::boolean THEN NOW() WHEN $12::bytea IS NOT NULL THEN NOW() ELSE image_updated_at END,updated_at=NOW() WHERE id=$14`,
        [name,category,price,effectiveStock,effectiveMinStock,destination,saleUnit,stockPerSaleUnit,stockPoolId,active,removeImage,image?.data??null,image?.mime??null,productId]);
      await auditLog({userId:user.id,action:"PRODUCT_UPDATED",entityType:"PRODUCT",entityId:productId,description:`Atualizou o produto ${old.name}: valor ${moneyText(old.price_cents)} → ${moneyText(price)}.${stockDescription}`,metadata:{name,category,price,stock:effectiveStock,minStock:effectiveMinStock,unlimited:effectiveUnlimited,stockMode,stockPoolId,destination,saleUnit,stockPerSaleUnit,previousStockFactor:old.stock_per_sale_unit,active,imageChanged:Boolean(image)||removeImage}},client);
    });
  } catch(error){ fail(`/produtos/${productId}`,error instanceof Error?error.message:"Não foi possível atualizar o produto."); }
  revalidatePath("/produtos"); revalidatePath(`/produtos/${productId}`); revalidatePath("/estoque"); revalidatePath("/comandas");
  redirect("/produtos");
}

export async function deleteProductAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const productId = positiveId(formData.get("productId"));
  try {
    await transaction(async (client) => {
      const product=await client.query<{name:string}>("SELECT name FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[productId]);
      if(!product.rows[0]) throw new Error("Produto não encontrado ou já excluído.");
      await client.query("UPDATE products SET active=FALSE,deleted_at=NOW(),updated_at=NOW() WHERE id=$1",[productId]);
      await auditLog({userId:user.id,action:"PRODUCT_DELETED",entityType:"PRODUCT",entityId:productId,description:`Excluiu o cadastro do produto ${product.rows[0].name}. O histórico anterior foi preservado.`,metadata:{productName:product.rows[0].name}},client);
    });
  } catch(error){ fail("/produtos",error instanceof Error?error.message:"Não foi possível excluir o produto."); }
  revalidatePath("/produtos"); revalidatePath("/estoque"); revalidatePath("/comandas"); revalidatePath("/painel");
  redirect("/produtos");
}

export async function addDraftKegAction(formData: FormData) {
  const user = await requirePermission("STOCK");
  const stockKind=String(formData.get("stockKind")??"");
  const kegCount=Math.trunc(numberValue(formData.get("kegCount"),1));
  if(!["DRAFT_BEER","DRAFT_WINE"].includes(stockKind)||kegCount<1||kegCount>20) fail("/estoque","Informe de 1 a 20 galões.");
  try{
    await transaction(async(client)=>{
      const pool=await client.query<{id:number;name:string;stock_quantity:number|string}>("SELECT id,name,stock_quantity FROM stock_pools WHERE stock_kind=$1 FOR UPDATE",[stockKind]);
      if(!pool.rows[0]) throw new Error("Estoque de chopp não encontrado.");
      const added=kegCount*50;
      const newStock=Number(pool.rows[0].stock_quantity)+added;
      await client.query("UPDATE stock_pools SET stock_quantity=$1,updated_at=NOW() WHERE id=$2",[newStock,pool.rows[0].id]);
      const product=await client.query<{id:number}>("SELECT id FROM products WHERE stock_pool_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1",[pool.rows[0].id]);
      if(product.rows[0]) await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,user_id) VALUES ($1,$2,$3,'KEG_ADDED',$4)",[product.rows[0].id,pool.rows[0].id,added,user.id]);
      await auditLog({userId:user.id,action:"DRAFT_KEG_ADDED",entityType:"STOCK_POOL",entityId:pool.rows[0].id,description:`Adicionou ${kegCount} galão(ões) de 50 L ao ${pool.rows[0].name}. Novo saldo: ${newStock} L.`,metadata:{stockKind,kegCount,addedLiters:added,previousStock:pool.rows[0].stock_quantity,newStock}},client);
    });
  }catch(error){fail("/estoque",error instanceof Error?error.message:"Não foi possível adicionar o galão.");}
  revalidatePath("/estoque"); revalidatePath("/produtos"); revalidatePath("/comandas"); revalidatePath("/painel");
  redirect("/estoque");
}

export async function adjustStockAction(formData: FormData) {
  const user = await requirePermission("STOCK");
  const productId = positiveId(formData.get("productId"));
  const quantity = quantityValue(formData.get("quantity"));
  if (quantity === 0) fail("/estoque", "Informe uma quantidade diferente de zero.");
  try {
    await transaction(async (client) => {
      const current = await client.query<{ name:string;stock_pool_id:number;stock_quantity:number|string;unlimited:boolean }>("SELECT p.name,p.stock_pool_id,sp.stock_quantity,sp.unlimited FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p,sp", [productId]);
      if (!current.rows[0]) throw new Error("Produto não encontrado.");
      if (current.rows[0].unlimited) throw new Error("Produtos com estoque ilimitado não recebem ajuste de saldo.");
      if (Number(current.rows[0].stock_quantity) + quantity < 0) throw new Error("O ajuste deixaria o estoque negativo.");
      const newStock = Number(current.rows[0].stock_quantity) + quantity;
      await client.query("UPDATE stock_pools SET stock_quantity=$1,updated_at=NOW() WHERE id=$2", [newStock, current.rows[0].stock_pool_id]);
      await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,user_id) VALUES ($1,$2,$3,'MANUAL_ADJUSTMENT',$4)", [productId, current.rows[0].stock_pool_id, quantity, user.id]);
      await auditLog({ userId:user.id, action:"STOCK_ADJUSTED", entityType:"STOCK_POOL", entityId:current.rows[0].stock_pool_id, description:`Ajustou o estoque de ${current.rows[0].name} em ${quantity > 0 ? "+" : ""}${quantity}. Novo saldo: ${newStock}.`, metadata:{ productId,stockPoolId:current.rows[0].stock_pool_id,quantity,previousStock:current.rows[0].stock_quantity,newStock } }, client);
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

export async function updateTableAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const tableId = positiveId(formData.get("tableId"));
  const number = Math.trunc(numberValue(formData.get("number")));
  const label = String(formData.get("label") ?? "").trim() || `Mesa ${number}`;
  const active = formData.get("active") === "on";
  if (number < 1 || label.length > 80) fail(`/configuracoes/mesas/${tableId}`, "Revise o número e o nome da mesa.");
  try {
    await transaction(async (client) => {
      const current = await client.query<{ number:number;label:string|null }>("SELECT number,label FROM bar_tables WHERE id=$1 FOR UPDATE", [tableId]);
      if (!current.rows[0]) throw new Error("Mesa não encontrada.");
      if (!active) {
        const openCommands = await client.query<{ count:string }>("SELECT COUNT(*)::text AS count FROM command_tables ct JOIN commands c ON c.id=ct.command_id WHERE ct.table_id=$1 AND c.status='OPEN'", [tableId]);
        if (Number(openCommands.rows[0]?.count) > 0) throw new Error("Esta mesa possui comandas abertas e não pode ser inativada.");
      }
      await client.query("UPDATE bar_tables SET number=$1,label=$2,active=$3 WHERE id=$4", [number, label, active, tableId]);
      await auditLog({ userId:user.id, action:"TABLE_UPDATED", entityType:"TABLE", entityId:tableId, description:`Alterou a mesa ${current.rows[0].number} para ${label} (número ${number}) e marcou como ${active ? "ativa" : "inativa"}.`, metadata:{ previousNumber:current.rows[0].number, number, label, active } }, client);
    });
  } catch (error) { fail(`/configuracoes/mesas/${tableId}`, error instanceof Error ? error.message : "Não foi possível atualizar a mesa."); }
  revalidatePath("/configuracoes");
  revalidatePath("/comandas");
  revalidatePath("/cozinha");
  redirect("/configuracoes");
}

export async function createUserAction(formData: FormData) {
  const actor = await requireRole(["ADMIN","MANAGER"]);
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const roleValue = String(formData.get("role") ?? "");
  const roles:Role[] = ["ADMIN","MANAGER","CASHIER","KITCHEN","WAITER","ATTENDANT"];
  if (name.length < 2 || username.length < 3 || password.length < 8 || !roles.includes(roleValue as Role)) fail("/configuracoes", "Revise os dados do funcionário.");
  const role = roleValue as Role;
  if (actor.role === "MANAGER" && !["CASHIER","KITCHEN","WAITER","ATTENDANT"].includes(role)) fail("/configuracoes", "Gerentes podem cadastrar somente Caixa, Cozinha, Garçom ou Atendente.");
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

export async function toggleUserStatusAction(formData: FormData) {
  const actor=await requireRole(["ADMIN","MANAGER"]);
  const userId=positiveId(formData.get("userId"));
  const nextActive=formData.get("nextActive")==="true";
  try{
    await transaction(async(client)=>{
      const target=await client.query<{name:string;role:Role;active:boolean}>("SELECT name,role,active FROM users WHERE id=$1 FOR UPDATE",[userId]);
      if(!target.rows[0]) throw new Error("Funcionário não encontrado.");
      if(userId===actor.id&&!nextActive) throw new Error("Você não pode inativar o próprio usuário.");
      if(actor.role==="MANAGER"&&isManagementRole(target.rows[0].role)) throw new Error("Somente Administradores podem alterar Gerentes ou Administradores.");
      if(target.rows[0].role==="ADMIN"&&!nextActive){const admins=await client.query<{id:number}>("SELECT id FROM users WHERE role='ADMIN' AND active=TRUE FOR UPDATE");if(admins.rows.length<=1)throw new Error("O sistema precisa manter ao menos um Administrador ativo.");}
      await client.query("UPDATE users SET active=$1 WHERE id=$2",[nextActive,userId]);
      if(!nextActive) await client.query("DELETE FROM sessions WHERE user_id=$1",[userId]);
      await auditLog({userId:actor.id,action:"USER_STATUS_CHANGED",entityType:"USER",entityId:userId,description:`${nextActive?"Ativou":"Inativou"} o funcionário ${target.rows[0].name}.`,metadata:{active:nextActive,role:target.rows[0].role}},client);
    });
  }catch(error){fail("/configuracoes",error instanceof Error?error.message:"Não foi possível alterar o funcionário.");}
  revalidatePath("/configuracoes"); redirect("/configuracoes");
}

export async function changeOwnPasswordAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (newPassword.length < 8) fail("/configuracoes", "A nova senha deve ter pelo menos 8 caracteres.");
  if (newPassword !== confirmation) fail("/configuracoes", "A confirmação da nova senha não confere.");
  try {
    await transaction(async (client) => {
      const result = await client.query<{ password_hash:string }>("SELECT password_hash FROM users WHERE id=$1 AND active=TRUE FOR UPDATE", [user.id]);
      if (!result.rows[0]) throw new Error("Usuário não encontrado.");
      if (!(await verifyPassword(currentPassword, result.rows[0].password_hash))) throw new Error("A senha atual está incorreta.");
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(newPassword), user.id]);
      await auditLog({ userId:user.id, action:"PASSWORD_CHANGED", entityType:"USER", entityId:user.id, description:"Alterou a própria senha." }, client);
    });
  } catch (error) { fail("/configuracoes", error instanceof Error ? error.message : "Não foi possível alterar a senha."); }
  redirect("/configuracoes?sucesso=senha");
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
      const sale = await client.query<{ command_id:number;status:string;total_cents:number;command_number:number;display_label:string }>("SELECT s.command_id,s.status,s.total_cents,c.command_number,cl.display_label FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE s.id=$1 FOR UPDATE OF s", [saleId]);
      if (!sale.rows[0] || sale.rows[0].status !== "COMPLETED") throw new Error("Venda não pode ser cancelada.");
      const items = await client.query<{ id:number;product_id:number;stock_pool_id:number;stock_quantity_used:number|string }>("SELECT id,product_id,stock_pool_id,stock_quantity_used FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [sale.rows[0].command_id]);
      for (const item of items.rows) {
        if (Number(item.stock_quantity_used) <= 0) continue;
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.stock_quantity_used, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'SALE_CANCELLED',$4,$5)", [item.product_id, item.stock_pool_id, item.stock_quantity_used, item.id, user.id]);
      }
      await client.query("UPDATE sales SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),cancellation_reason=$2 WHERE id=$3", [user.id, reason, saleId]);
      await client.query("UPDATE commands SET status='CANCELLED' WHERE id=$1", [sale.rows[0].command_id]);
      await auditLog({ userId:user.id, action:"SALE_CANCELLED", entityType:"SALE", entityId:saleId, description:`Cancelou a venda #${saleId}, comanda #${sale.rows[0].command_number}, ${sale.rows[0].display_label}, de ${moneyText(Number(sale.rows[0].total_cents))}. Motivo: ${reason}`, metadata:{ reason, commandId:sale.rows[0].command_id, commandNumber:sale.rows[0].command_number, table:sale.rows[0].display_label } }, client);
    });
  } catch (error) { fail("/relatorios", error instanceof Error ? error.message : "Não foi possível cancelar a venda."); }
  revalidatePath("/relatorios");
  revalidatePath("/estoque");
  revalidatePath("/caixa");
  redirect("/relatorios");
}
