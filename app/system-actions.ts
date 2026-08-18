"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { hashPassword, requirePermission, requireRole, requireUser, verifyPassword } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { canManageCommand, defaultPermissionsByRole, isManagementRole, isPermission, permissionConfig, type Role } from "@/lib/roles";
import { commandLabel, saleReferenceLabel } from "@/lib/command-label";
import { courierText, deliveryOrderLabel } from "@/lib/delivery";
import { normalizeQuickSaleCheckoutDraft, quickSalePendingLabel } from "@/lib/quick-sale-draft";

type CommandAuditRecord = { command_number:number|null; command_name:string|null; display_label:string };

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
function cpfValue(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/\D/g, "");
}
type SalePaymentMethod="CASH"|"PIX"|"DEBIT"|"CREDIT"|"STAFF_VOUCHER"|"STORE_CREDIT";
type SalePaymentAllocation={method:SalePaymentMethod;amountCents:number;staffMemberId?:number;customerId?:number};
const salePaymentMethods=new Set<SalePaymentMethod>(["CASH","PIX","DEBIT","CREDIT","STAFF_VOUCHER","STORE_CREDIT"]);
function paymentAllocationsValue(formData:FormData):SalePaymentAllocation[]{
  const raw=String(formData.get("paymentAllocations")??"").trim();
  if(!raw){
    const legacy:Array<[SalePaymentMethod,number]>=[["CASH",cents(formData.get("cash"))],["PIX",cents(formData.get("pix"))],["DEBIT",cents(formData.get("debit"))],["CREDIT",cents(formData.get("credit"))],["STAFF_VOUCHER",cents(formData.get("staffVoucher"))]];
    if(legacy.some(([method,amountCents])=>method==="STAFF_VOUCHER"&&amountCents>0)) throw new Error("Atualize a página e selecione o funcionário responsável pelo vale.");
    return legacy.filter(([,amountCents])=>amountCents>0).map(([method,amountCents])=>({method,amountCents}));
  }
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error("As formas de pagamento estão inválidas.");}
  if(!Array.isArray(parsed)||parsed.length<1||parsed.length>50) throw new Error("As formas de pagamento estão inválidas.");
  return parsed.map((entry)=>{
    if(!entry||typeof entry!=="object") throw new Error("Um dos pagamentos está inválido.");
    const source=entry as Record<string,unknown>;
    const method=String(source.method??"") as SalePaymentMethod;
    const amountCents=Math.trunc(Number(source.amountCents));
    if(!salePaymentMethods.has(method)||!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>2147483647) throw new Error("Um dos pagamentos está inválido.");
    const staffMemberId=Math.trunc(Number(source.staffMemberId));
    const customerId=Math.trunc(Number(source.customerId));
    if(method==="STAFF_VOUCHER"&&(!Number.isSafeInteger(staffMemberId)||staffMemberId<1)) throw new Error("Selecione o funcionário responsável pelo vale.");
    if(method==="STORE_CREDIT"&&(!Number.isSafeInteger(customerId)||customerId<1)) throw new Error("Consulte e confirme o cliente antes de usar o crédito em loja.");
    return{method,amountCents,staffMemberId:method==="STAFF_VOUCHER"?staffMemberId:undefined,customerId:method==="STORE_CREDIT"?customerId:undefined};
  });
}
type QuickSaleItemInput={productId:number;quantity:number};
function quickSaleItemsFromRaw(rawValue:string,allowEmpty=false):QuickSaleItemInput[]{
  const raw=rawValue.trim();
  if(!raw){
    if(allowEmpty)return[];
    throw new Error("Adicione ao menos um produto à venda rápida.");
  }
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error("Os itens da venda rápida estão inválidos.");}
  if(!Array.isArray(parsed)||parsed.length>200||(!allowEmpty&&parsed.length<1)) throw new Error("Adicione ao menos um produto à venda rápida.");
  if(parsed.length===0)return[];
  const quantities=new Map<number,number>();
  for(const entry of parsed){
    if(!entry||typeof entry!=="object") throw new Error("Um dos itens da venda rápida está inválido.");
    const source=entry as Record<string,unknown>;
    const productId=Math.trunc(Number(source.productId));
    const quantity=Math.trunc(Number(source.quantity));
    if(!Number.isSafeInteger(productId)||productId<1||!Number.isSafeInteger(quantity)||quantity<1) throw new Error("Um dos itens da venda rápida está inválido.");
    const accumulated=(quantities.get(productId)||0)+quantity;
    if(accumulated>9999) throw new Error("A quantidade de um dos produtos ultrapassa o limite permitido.");
    quantities.set(productId,accumulated);
  }
  if(quantities.size>100) throw new Error("A venda rápida permite até 100 produtos diferentes.");
  return[...quantities].map(([productId,quantity])=>({productId,quantity})).sort((a,b)=>a.productId-b.productId);
}
function quickSaleItemsValue(formData:FormData):QuickSaleItemInput[]{
  return quickSaleItemsFromRaw(String(formData.get("quickSaleItems")??""));
}

export async function saveQuickSaleDraftAction(formData:FormData):Promise<{success?:boolean;draftId?:number|null;error?:string}>{
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  let items:QuickSaleItemInput[]=[];
  let checkoutState=normalizeQuickSaleCheckoutDraft(null);
  const draftIdRaw=String(formData.get("quickSaleDraftId")??"").trim();
  const requestedDraftId=draftIdRaw?Math.trunc(Number(draftIdRaw)):null;
  if(requestedDraftId!==null&&(!Number.isSafeInteger(requestedDraftId)||requestedDraftId<1)) return{error:"A pendência de venda informada é inválida."};
  try{
    items=quickSaleItemsFromRaw(String(formData.get("quickSaleItems")??"[]"),true);
    const checkoutRaw=String(formData.get("quickSaleCheckout")??"{}");
    if(checkoutRaw.length>40000) throw new Error("Os dados do rascunho ultrapassam o limite permitido.");
    checkoutState=normalizeQuickSaleCheckoutDraft(JSON.parse(checkoutRaw));
  }catch(error){return{error:error instanceof Error?error.message:"Não foi possível salvar o rascunho da venda rápida."};}
  try{
    const draftId=await transaction(async(client)=>{
      if(items.length===0){
        if(requestedDraftId!==null) await client.query("DELETE FROM quick_sale_pending_orders WHERE id=$1",[requestedDraftId]);
        await client.query("DELETE FROM quick_sale_drafts WHERE user_id=$1",[user.id]);
        return null;
      }
      const productIds=items.map((item)=>item.productId);
      const products=await client.query<{id:number}>("SELECT id FROM products WHERE id=ANY($1::bigint[]) AND active=TRUE AND deleted_at IS NULL AND name NOT ILIKE '%ESTOQUE%'",[productIds]);
      if(products.rows.length!==productIds.length) throw new Error("Um dos produtos do rascunho não está mais disponível.");
      if(requestedDraftId!==null){
        const updated=await client.query<{id:number}>("UPDATE quick_sale_pending_orders SET items=$1::jsonb,checkout_state=$2::jsonb,updated_by=$3,updated_at=NOW(),legacy_user_id=NULL WHERE id=$4 RETURNING id",[JSON.stringify(items),JSON.stringify(checkoutState),user.id,requestedDraftId]);
        if(updated.rows[0]){
          await client.query("DELETE FROM quick_sale_drafts WHERE user_id=$1",[user.id]);
          return Number(updated.rows[0].id);
        }
        throw new Error("Essa pendência de venda não existe mais. Abra uma nova venda rápida.");
      }
      const created=await client.query<{id:number}>("INSERT INTO quick_sale_pending_orders (items,checkout_state,created_by,updated_by) VALUES ($1::jsonb,$2::jsonb,$3,$3) RETURNING id",[JSON.stringify(items),JSON.stringify(checkoutState),user.id]);
      await client.query("DELETE FROM quick_sale_drafts WHERE user_id=$1",[user.id]);
      return Number(created.rows[0].id);
    });
    return{success:true,draftId};
  }catch(error){return{error:error instanceof Error?error.message:"Não foi possível sincronizar o rascunho da venda rápida."};}
}

export async function discardQuickSalePendingAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const draftId=positiveId(formData.get("quickSaleDraftId"));
  try{
    await transaction(async(client)=>{
      const draft=await client.query<{id:number}>("SELECT id FROM quick_sale_pending_orders WHERE id=$1 FOR UPDATE",[draftId]);
      if(!draft.rows[0]) throw new Error("Essa pendência de venda não existe mais.");
      await client.query("DELETE FROM quick_sale_pending_orders WHERE id=$1",[draftId]);
      await auditLog({userId:user.id,action:"QUICK_SALE_PENDING_DISCARDED",entityType:"QUICK_SALE_PENDING",entityId:draftId,description:`Descartou a pendência de venda ${quickSalePendingLabel(draftId)}.`},client);
    });
  }catch(error){fail("/pendencias-venda",error instanceof Error?error.message:"Não foi possível descartar a pendência de venda.");}
  revalidatePath("/pendencias-venda");
  revalidatePath("/venda-rapida");
  redirect("/pendencias-venda?sucesso=1");
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
      await auditLog({ userId:user.id, action:"CASH_OPENED", entityType:"CASH", entityId:created.rows[0].id, description:`Abriu o caixa com ${moneyText(openingAmount)} de fundo em espécie.` }, client);
    });
  } catch { fail("/caixa", "Já existe um caixa aberto."); }
  revalidatePath("/caixa");
  redirect("/caixa");
}

export async function createCustomerAction(formData:FormData){
  const user=await requirePermission("CUSTOMERS");
  const name=String(formData.get("name")??"").trim().replace(/\s+/g," ");
  const cpf=cpfValue(formData.get("cpf"));
  const contact=String(formData.get("contact")??"").trim();
  if(name.length<2) fail("/clientes","Informe o nome do cliente.");
  if(cpf.length!==11) fail("/clientes","Informe um CPF com 11 números.");
  if(contact.length<5) fail("/clientes","Informe o contato do cliente.");
  try{
    await transaction(async(client)=>{
      const created=await client.query<{id:number}>("INSERT INTO customers (name,cpf,contact,created_by) VALUES ($1,$2,$3,$4) RETURNING id",[name,cpf,contact,user.id]);
      await auditLog({userId:user.id,action:"CUSTOMER_CREATED",entityType:"CUSTOMER",entityId:created.rows[0].id,description:`Cadastrou o cliente ${name}.`,metadata:{cpf,contact}},client);
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Não foi possível cadastrar o cliente.";
    fail("/clientes",message.includes("duplicate key")?"Já existe um cliente cadastrado com esse CPF.":message);
  }
  revalidatePath("/clientes");
  redirect("/clientes?sucesso=cliente");
}

export async function addCustomerCreditAction(formData:FormData){
  const user=await requirePermission("CUSTOMERS");
  const customerId=positiveId(formData.get("customerId"));
  const amount=cents(formData.get("amount"));
  const notes=String(formData.get("notes")??"").trim()||"Crédito concedido para uso futuro no bar";
  if(amount<=0) fail("/clientes","Informe um valor de crédito maior que zero.");
  try{
    await transaction(async(client)=>{
      const customer=await client.query<{name:string;store_credit_balance_cents:number}>("SELECT name,store_credit_balance_cents FROM customers WHERE id=$1 AND active=TRUE FOR UPDATE",[customerId]);
      if(!customer.rows[0]) throw new Error("Cliente não encontrado ou inativo.");
      const balance=Number(customer.rows[0].store_credit_balance_cents)+amount;
      await client.query("UPDATE customers SET store_credit_balance_cents=$1,updated_at=NOW() WHERE id=$2",[balance,customerId]);
      await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,notes,created_by) VALUES ($1,$2,'CREDIT_GRANTED',$3,$4)",[customerId,amount,notes,user.id]);
      await auditLog({userId:user.id,action:"CUSTOMER_CREDIT_GRANTED",entityType:"CUSTOMER",entityId:customerId,description:`Adicionou ${moneyText(amount)} de crédito em loja para ${customer.rows[0].name}.`,metadata:{amount,previousBalance:customer.rows[0].store_credit_balance_cents,balance,notes}},client);
    });
  }catch(error){fail("/clientes",error instanceof Error?error.message:"Não foi possível adicionar o crédito.");}
  revalidatePath("/clientes");
  redirect("/clientes?sucesso=credito");
}

export async function createStaffMemberAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER"]);
  const name=String(formData.get("name")??"").trim().replace(/\s+/g," ");
  const cpf=cpfValue(formData.get("cpf"))||null;
  const contact=String(formData.get("contact")??"").trim()||null;
  const position=String(formData.get("position")??"").trim().replace(/\s+/g," ")||null;
  if(name.length<2) fail("/funcionarios","Informe o nome do funcionário.");
  if(cpf&&cpf.length!==11) fail("/funcionarios","Informe um CPF com 11 números ou deixe o campo vazio.");
  try{
    await transaction(async(client)=>{
      const created=await client.query<{id:number}>("INSERT INTO staff_members (name,cpf,contact,position,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",[name,cpf,contact,position,user.id]);
      await auditLog({userId:user.id,action:"STAFF_MEMBER_CREATED",entityType:"STAFF_MEMBER",entityId:created.rows[0].id,description:`Cadastrou ${name} na relação de funcionários para vales.`,metadata:{cpf,contact,position}},client);
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Não foi possível cadastrar o funcionário.";
    fail("/funcionarios",message.includes("duplicate key")?"Já existe um funcionário cadastrado com esse CPF.":message);
  }
  revalidatePath("/funcionarios");
  revalidatePath("/comandas");
  redirect("/funcionarios?sucesso=cadastro");
}

export async function toggleStaffMemberStatusAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER"]);
  const staffMemberId=positiveId(formData.get("staffMemberId"));
  const nextActive=formData.get("nextActive")==="true";
  try{
    await transaction(async(client)=>{
      const staff=await client.query<{name:string;active:boolean}>("SELECT name,active FROM staff_members WHERE id=$1 FOR UPDATE",[staffMemberId]);
      if(!staff.rows[0]) throw new Error("Funcionário não encontrado.");
      await client.query("UPDATE staff_members SET active=$1,updated_at=NOW() WHERE id=$2",[nextActive,staffMemberId]);
      await auditLog({userId:user.id,action:"STAFF_MEMBER_STATUS_CHANGED",entityType:"STAFF_MEMBER",entityId:staffMemberId,description:`${nextActive?"Ativou":"Inativou"} ${staff.rows[0].name} na relação de funcionários para vales.`,metadata:{active:nextActive}},client);
    });
  }catch(error){fail("/funcionarios",error instanceof Error?error.message:"Não foi possível alterar o funcionário.");}
  revalidatePath("/funcionarios");
  revalidatePath("/comandas");
  redirect(`/funcionarios?sucesso=${nextActive?"ativado":"inativado"}`);
}

export async function settleStaffVoucherAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER"]);
  const paymentId=positiveId(formData.get("paymentId"));
  const settlementType=String(formData.get("settlementType")??"");
  const note=String(formData.get("note")??"").trim()||null;
  if(!["PAID","PAYROLL_DISCOUNT"].includes(settlementType)) fail("/pendencias","Selecione como o vale foi quitado.");
  try{
    await transaction(async(client)=>{
      const payment=await client.query<{amount_cents:number;staff_member_name:string;sale_id:number}>("SELECT amount_cents,staff_member_name,sale_id FROM payments WHERE id=$1 AND method='STAFF_VOUCHER' AND staff_voucher_status='PENDING' AND voided_at IS NULL FOR UPDATE",[paymentId]);
      if(!payment.rows[0]) throw new Error("Esse vale não está mais pendente.");
      await client.query("UPDATE payments SET staff_voucher_status='SETTLED',staff_voucher_settlement_type=$1,staff_voucher_settled_at=NOW(),staff_voucher_settled_by=$2,staff_voucher_settlement_note=$3 WHERE id=$4",[settlementType,user.id,note,paymentId]);
      const label=settlementType==="PAID"?"pago pelo funcionário":"descontado do pagamento";
      await auditLog({userId:user.id,action:"STAFF_VOUCHER_SETTLED",entityType:"PAYMENT",entityId:paymentId,description:`Marcou o vale de ${payment.rows[0].staff_member_name}, no valor de ${moneyText(payment.rows[0].amount_cents)}, como ${label}.`,metadata:{saleId:payment.rows[0].sale_id,settlementType,note}},client);
    });
  }catch(error){fail("/pendencias",error instanceof Error?error.message:"Não foi possível quitar o vale.");}
  revalidatePath("/pendencias");
  redirect("/pendencias?sucesso=1");
}

export async function updateSaleMovementAction(formData:FormData):Promise<{error?:string;success?:boolean}>{
  const user=await requireRole(["ADMIN","MANAGER"]);
  let saleId=0;
  let paymentAllocations:SalePaymentAllocation[]=[];
  try{
    saleId=positiveId(formData.get("saleId"));
    paymentAllocations=paymentAllocationsValue(formData);
  }catch(error){return{error:error instanceof Error?error.message:"Os dados do movimento estão inválidos."};}
  const customerRaw=String(formData.get("customerId")??"").trim();
  const customerId=customerRaw?Math.trunc(Number(customerRaw)):null;
  if(customerId!==null&&(!Number.isSafeInteger(customerId)||customerId<1)) return{error:"O cliente selecionado está inválido."};
  try{
    await transaction(async(client)=>{
      const sale=await client.query<{command_id:number;status:string;total_cents:number;customer_id:number|null;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string}>("SELECT s.command_id,s.status,s.total_cents,s.customer_id,c.command_number,c.command_name,c.sale_channel,cl.display_label AS table_display FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE s.id=$1 FOR UPDATE OF s,c",[saleId]);
      if(!sale.rows[0]||sale.rows[0].status!=="COMPLETED") throw new Error("Somente vendas concluídas podem ter o movimento alterado.");
      const paid=paymentAllocations.reduce((sum,payment)=>sum+payment.amountCents,0);
      if(paid!==Number(sale.rows[0].total_cents)) throw new Error(`A soma das formas de pagamento deve ser ${moneyText(Number(sale.rows[0].total_cents))}.`);
      if(paymentAllocations.some((payment)=>payment.method==="STORE_CREDIT")&&!customerId) throw new Error("Selecione um cliente para usar Crédito em loja.");
      paymentAllocations=paymentAllocations.map((payment)=>payment.method==="STORE_CREDIT"?{...payment,customerId:customerId as number}:payment);

      const currentPayments=await client.query<{id:number;method:SalePaymentMethod;amount_cents:number;customer_id:number|null;staff_member_id:number|null;staff_member_name:string|null;staff_voucher_status:string|null}>("SELECT id,method,amount_cents,customer_id,staff_member_id,staff_member_name,staff_voucher_status FROM payments WHERE sale_id=$1 AND voided_at IS NULL ORDER BY id FOR UPDATE",[saleId]);
      if(currentPayments.rows.some((payment)=>payment.method==="STAFF_VOUCHER"&&payment.staff_voucher_status==="SETTLED")) throw new Error("Esta venda possui vale já quitado. Revise a baixa antes de alterar as formas de pagamento.");

      const staffMemberIds=[...new Set(paymentAllocations.filter((payment)=>payment.method==="STAFF_VOUCHER").map((payment)=>payment.staffMemberId as number))].sort((a,b)=>a-b);
      const staffMembersById=new Map<number,string>();
      if(staffMemberIds.length>0){
        const staffMembers=await client.query<{id:number;name:string}>("SELECT id,name FROM staff_members WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY id FOR SHARE",[staffMemberIds]);
        if(staffMembers.rows.length!==staffMemberIds.length) throw new Error("Um dos funcionários selecionados não está ativo ou não foi encontrado.");
        for(const staffMember of staffMembers.rows) staffMembersById.set(Number(staffMember.id),staffMember.name);
      }

      const oldStoreCredits=currentPayments.rows.filter((payment)=>payment.method==="STORE_CREDIT"&&payment.customer_id);
      const customerIds=[...new Set([...oldStoreCredits.map((payment)=>Number(payment.customer_id)),...(customerId?[customerId]:[])])].sort((a,b)=>a-b);
      const customerRows=customerIds.length>0?await client.query<{id:number;name:string;active:boolean;store_credit_balance_cents:number}>("SELECT id,name,active,store_credit_balance_cents FROM customers WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE",[customerIds]):{rows:[] as Array<{id:number;name:string;active:boolean;store_credit_balance_cents:number}>};
      if(customerRows.rows.length!==customerIds.length) throw new Error("Um dos clientes vinculados ao movimento não foi encontrado.");
      const customersById=new Map(customerRows.rows.map((customer)=>[Number(customer.id),customer]));
      const selectedCustomer=customerId?customersById.get(customerId):null;
      if(customerId&&(!selectedCustomer||!selectedCustomer.active)) throw new Error("O cliente selecionado está inativo ou não foi encontrado.");

      const restoredByCustomer=new Map<number,number>();
      for(const payment of oldStoreCredits){
        const linkedCustomerId=Number(payment.customer_id);
        restoredByCustomer.set(linkedCustomerId,(restoredByCustomer.get(linkedCustomerId)||0)+Number(payment.amount_cents));
        await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,sale_id,payment_id,notes,created_by) VALUES ($1,$2,'SALE_REFUNDED',$3,$4,$5,$6)",[linkedCustomerId,payment.amount_cents,saleId,payment.id,`Crédito devolvido pela manutenção da venda #${saleId}`,user.id]);
      }
      for(const [linkedCustomerId,amount] of restoredByCustomer) await client.query("UPDATE customers SET store_credit_balance_cents=store_credit_balance_cents+$1,updated_at=NOW() WHERE id=$2",[amount,linkedCustomerId]);

      await client.query("UPDATE payments SET staff_voucher_status='CANCELLED' WHERE sale_id=$1 AND method='STAFF_VOUCHER' AND staff_voucher_status='PENDING' AND voided_at IS NULL",[saleId]);
      await client.query("UPDATE payments SET voided_at=NOW(),voided_by=$1,void_reason='MOVEMENT_MAINTENANCE' WHERE sale_id=$2 AND voided_at IS NULL",[user.id,saleId]);

      const newStoreCreditTotals=new Map<number,number>();
      for(const payment of paymentAllocations) if(payment.method==="STORE_CREDIT"&&payment.customerId) newStoreCreditTotals.set(payment.customerId,(newStoreCreditTotals.get(payment.customerId)||0)+payment.amountCents);
      for(const [linkedCustomerId,amount] of newStoreCreditTotals){
        const customer=customersById.get(linkedCustomerId);
        const balance=Number(customer?.store_credit_balance_cents??0)+(restoredByCustomer.get(linkedCustomerId)||0);
        if(amount>balance) throw new Error(`O crédito disponível de ${customer?.name??"cliente"} é ${moneyText(balance)}.`);
      }

      for(const payment of paymentAllocations){
        const staffMemberName=payment.staffMemberId?staffMembersById.get(payment.staffMemberId)??null:null;
        const createdPayment=await client.query<{id:number}>("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents,customer_id,staff_member_id,staff_member_name,staff_voucher_status) VALUES ($1,$2,$3,NULL,0,$4,$5,$6,$7) RETURNING id",[saleId,payment.method,payment.amountCents,payment.customerId??null,payment.staffMemberId??null,staffMemberName,payment.method==="STAFF_VOUCHER"?"PENDING":null]);
        if(payment.method==="STORE_CREDIT"&&payment.customerId){
          await client.query("UPDATE customers SET store_credit_balance_cents=store_credit_balance_cents-$1,updated_at=NOW() WHERE id=$2",[payment.amountCents,payment.customerId]);
          await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,sale_id,payment_id,notes,created_by) VALUES ($1,$2,'SALE_USED',$3,$4,$5,$6)",[payment.customerId,-payment.amountCents,saleId,createdPayment.rows[0].id,`Crédito aplicado na manutenção da venda #${saleId}`,user.id]);
        }
      }

      await client.query("UPDATE sales SET customer_id=$1 WHERE id=$2",[customerId,saleId]);
      await client.query("UPDATE commands SET customer_name=$1 WHERE id=$2",[selectedCustomer?.name??null,sale.rows[0].command_id]);
      await auditLog({userId:user.id,action:"SALE_MOVEMENT_UPDATED",entityType:"SALE",entityId:saleId,description:`Atualizou cliente e formas de pagamento da venda #${saleId}, ${saleReferenceLabel(sale.rows[0])}.`,metadata:{saleChannel:sale.rows[0].sale_channel,previousCustomerId:sale.rows[0].customer_id,customerId,previousPayments:currentPayments.rows.map((payment)=>({id:payment.id,method:payment.method,amountCents:payment.amount_cents,customerId:payment.customer_id,staffMemberId:payment.staff_member_id})),payments:paymentAllocations}},client);
    });
  }catch(error){return{error:error instanceof Error?error.message:"Não foi possível atualizar o movimento."};}
  revalidatePath("/manutencao-movimento");
  revalidatePath("/relatorios");
  revalidatePath("/caixa");
  revalidatePath("/painel");
  revalidatePath("/pendencias");
  revalidatePath("/clientes");
  revalidatePath("/funcionarios");
  return{success:true};
}

export async function closeCashAction(formData: FormData) {
  const user = await requireRole(["ADMIN","MANAGER"]);
  const cashId = positiveId(formData.get("cashId"));
  const format = String(formData.get("format") ?? "80");
  const closingAmount = cents(formData.get("closingAmount"));
  const confirmedPayments = {
    PIX: cents(formData.get("confirmedPix")),
    DEBIT: cents(formData.get("confirmedDebit")),
    CREDIT: cents(formData.get("confirmedCredit")),
    STAFF_VOUCHER: cents(formData.get("confirmedStaffVoucher")),
    STORE_CREDIT: cents(formData.get("confirmedStoreCredit")),
  };
  const notes = String(formData.get("notes") ?? "").trim() || null;
  try {
    await transaction(async (client) => {
      const openCommands = await client.query<{ count:string }>("SELECT COUNT(*)::text AS count FROM commands WHERE status='OPEN'");
      if (Number(openCommands.rows[0]?.count) > 0) throw new Error("Feche as comandas abertas antes de encerrar o caixa.");
      const current = await client.query<{ opening_amount_cents:number }>("SELECT opening_amount_cents FROM cash_sessions WHERE id=$1 AND status='OPEN' FOR UPDATE", [cashId]);
      if (!current.rows[0]) throw new Error("Caixa não encontrado ou já fechado.");
      const [sales, paymentRows] = await Promise.all([
        client.query<{ total:string }>("SELECT COALESCE(SUM(total_cents),0)::text AS total FROM sales WHERE cash_session_id=$1 AND status='COMPLETED'", [cashId]),
        client.query<{ method:string; total:string }>(`SELECT p.method,COALESCE(SUM(p.amount_cents),0)::text AS total FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$1 AND s.status='COMPLETED' AND p.voided_at IS NULL GROUP BY p.method`, [cashId]),
      ]);
      const paymentTotals = Object.fromEntries(paymentRows.rows.map((row) => [row.method, Number(row.total)])) as Record<string,number>;
      const salesTotal = Number(sales.rows[0]?.total ?? 0);
      const paymentsTotal = Object.values(paymentTotals).reduce((sum, value) => sum + value, 0);
      if (salesTotal !== paymentsTotal) throw new Error(`O total das vendas (${moneyText(salesTotal)}) não confere com os pagamentos registrados (${moneyText(paymentsTotal)}). Revise as vendas antes de fechar o caixa.`);
      for (const [method,confirmed] of Object.entries(confirmedPayments)) {
        const registered = paymentTotals[method] ?? 0;
        if (confirmed !== registered) {
          const labels:Record<string,string> = { PIX:"PIX", DEBIT:"débito", CREDIT:"crédito", STAFF_VOUCHER:"vale funcionário", STORE_CREDIT:"crédito em loja" };
          throw new Error(`O valor conferido em ${labels[method]} não confere. Registrado no sistema: ${moneyText(registered)}.`);
        }
      }
      const cashSales = paymentTotals.CASH ?? 0;
      const expected = Number(current.rows[0].opening_amount_cents) + cashSales;
      if (closingAmount !== expected) throw new Error(`O dinheiro contado não confere. Deve haver ${moneyText(expected)} em espécie: ${moneyText(current.rows[0].opening_amount_cents)} de fundo + ${moneyText(cashSales)} das vendas.`);
      await client.query("UPDATE cash_sessions SET status='CLOSED',closed_by=$1,closed_at=NOW(),closing_amount_cents=$2,expected_amount_cents=$3,notes=$4 WHERE id=$5 AND status='OPEN'", [user.id, closingAmount, expected, notes, cashId]);
      await auditLog({ userId:user.id, action:"CASH_CLOSED", entityType:"CASH", entityId:cashId, description:`Fechou o caixa após conferir ${moneyText(salesTotal)} em vendas e ${moneyText(expected)} em espécie.`, metadata:{ openingAmount:current.rows[0].opening_amount_cents, salesTotal, paymentsTotal, paymentTotals, closingAmount, expected } }, client);
    });
  } catch (error) { return {error:error instanceof Error ? error.message : "Não foi possível fechar o caixa."}; }
  revalidatePath("/caixa");
  return {url:`/imprimir/caixa/${cashId}?formato=${encodeURIComponent(format)}`};
}

export async function openCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandNumberText = String(formData.get("commandNumber") ?? "").trim();
  const commandNumber = commandNumberText ? Number(commandNumberText) : null;
  const commandName = String(formData.get("commandName") ?? "").trim().replace(/\s+/g," ") || null;
  const tableIds = [...new Set(formData.getAll("tableIds").map((value)=>Math.trunc(numberValue(value))).filter((id)=>id>0))];
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (commandNumber !== null && (!Number.isSafeInteger(commandNumber) || commandNumber < 1 || commandNumber > 2147483647)) fail("/comandas", "Informe um número de comanda válido.");
  if (commandNumber === null && !commandName) fail("/comandas", "Informe o número ou o nome da comanda.");
  if (commandName && commandName.length > 80) fail("/comandas", "O nome da comanda deve ter no máximo 80 caracteres.");
  if (tableIds.length < 1) fail("/comandas", "Selecione ao menos uma mesa para a comanda.");
  let commandId = 0;
  try {
    commandId = await transaction(async (client) => {
      const tables = await client.query<{id:number;label:string;active:boolean}>("SELECT id,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables WHERE id=ANY($1::bigint[]) ORDER BY number FOR UPDATE",[tableIds]);
      if(tables.rows.length!==tableIds.length||tables.rows.some((table)=>!table.active)) throw new Error("Uma das mesas selecionadas está indisponível.");
      const primaryTableId=tables.rows[0].id;
      const created = await client.query<{ id:number }>("INSERT INTO commands (command_number,command_name,table_id,customer_name,opened_by,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [commandNumber, commandName, primaryTableId, customerName, user.id, notes]);
      for(const table of tables.rows) await client.query("INSERT INTO command_tables (command_id,table_id) VALUES ($1,$2)",[created.rows[0].id,table.id]);
      const displayLabel=tables.rows.map((table)=>table.label).join(" + ");
      await auditLog({ userId:user.id, action:"COMMAND_OPENED", entityType:"COMMAND", entityId:created.rows[0].id, description:`Abriu a comanda ${commandLabel({command_number:commandNumber,command_name:commandName})} em ${displayLabel}.`, metadata:{ commandNumber, commandName, tableIds:tables.rows.map((table)=>table.id), table:displayLabel } }, client);
      return created.rows[0].id;
    });
  } catch (error) {
    const databaseError=error as {code?:string;constraint?:string};
    const message=error instanceof Error?error.message:"Não foi possível abrir a comanda.";
    if(databaseError.code==="23505") fail("/comandas",databaseError.constraint==="commands_open_name_idx"?"Já existe uma comanda aberta com esse nome.":"Esse número de comanda já está em uso.");
    fail("/comandas",message);
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
      const command=await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c",[commandId]);
      if(!command.rows[0]) throw new Error("A comanda não está aberta.");
      const tables=await client.query<{id:number;label:string;active:boolean}>("SELECT id,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables WHERE id=ANY($1::bigint[]) ORDER BY number FOR UPDATE",[tableIds]);
      if(tables.rows.length!==tableIds.length||tables.rows.some((table)=>!table.active)) throw new Error("Uma das mesas selecionadas está indisponível.");
      await client.query("DELETE FROM command_tables WHERE command_id=$1",[commandId]);
      for(const table of tables.rows) await client.query("INSERT INTO command_tables (command_id,table_id) VALUES ($1,$2)",[commandId,table.id]);
      await client.query("UPDATE commands SET table_id=$1 WHERE id=$2",[tables.rows[0].id,commandId]);
      const displayLabel=tables.rows.map((table)=>table.label).join(" + ");
      await auditLog({userId:user.id,action:"COMMAND_TABLES_UPDATED",entityType:"COMMAND",entityId:commandId,description:`Alterou as mesas da comanda ${commandLabel(command.rows[0])}: ${command.rows[0].display_label} → ${displayLabel}.`,metadata:{commandNumber:command.rows[0].command_number,commandName:command.rows[0].command_name,previousTables:command.rows[0].display_label,tableIds:tables.rows.map((table)=>table.id),tables:displayLabel}},client);
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
      const command = await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const product = await client.query<{ name:string;price_cents:number;cost_cents:number;stock_pool_id:number;stock_quantity:number|string;stock_unlimited:boolean;destination:string;sale_unit:string;stock_per_sale_unit:number|string }>("SELECT p.name,p.price_cents,p.cost_cents,p.stock_pool_id,sp.stock_quantity,sp.unlimited AS stock_unlimited,p.destination,p.sale_unit,p.stock_per_sale_unit FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1 AND p.active=TRUE AND p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%' FOR UPDATE OF p,sp", [productId]);
      const item = product.rows[0];
      if (!item) throw new Error("Produto indisponível.");
      const factor = Number(item.stock_per_sale_unit);
      if (!Number.isInteger(quantity)) throw new Error("Os produtos devem ser lançados por unidade.");
      const stockUsed = item.stock_unlimited ? 0 : Math.round(quantity * factor * 1000) / 1000;
      if (!item.stock_unlimited && Number(item.stock_quantity) < stockUsed) throw new Error(`Estoque insuficiente. Disponível: ${item.stock_quantity} ${item.sale_unit}.`);
      const displayUnit = "UNIT";
      const inserted = await client.query<{ id:number }>("INSERT INTO order_items (command_id,product_id,stock_pool_id,product_name,unit_price_cents,unit_cost_cents,quantity,stock_quantity_used,destination,sale_unit,display_unit,added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id", [commandId, productId, item.stock_pool_id, item.name, item.price_cents, item.cost_cents, quantity, stockUsed, item.destination, item.sale_unit, displayUnit, user.id]);
      if (!item.stock_unlimited) {
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2", [stockUsed, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'ITEM_ADDED',$4,$5)", [productId, item.stock_pool_id, -stockUsed, inserted.rows[0].id, user.id]);
      }
      const stockDetail = item.stock_unlimited ? " Estoque ilimitado." : ` Baixa interna de estoque: ${stockUsed} ${item.sale_unit}.`;
      await auditLog({ userId:user.id, action:"ITEM_ADDED", entityType:"COMMAND", entityId:commandId, description:`Adicionou ${quantity}× ${item.name} à comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}.${stockDetail}`, metadata:{ commandNumber:command.rows[0].command_number, commandName:command.rows[0].command_name, table:command.rows[0].display_label, productId, productName:item.name, quantity, stockPoolId:item.stock_pool_id, stockUsed, stockUnlimited:item.stock_unlimited, stockUnit:item.sale_unit, orderItemId:inserted.rows[0].id } }, client);
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
  if (!canManageCommand(user.role)) fail(`/comandas/${commandId}`, "Somente Caixa, Gerente ou Administrador pode alterar itens já lançados.");
  try {
    await transaction(async (client) => {
      const item = await client.query<{ product_id:number;stock_pool_id:number;product_name:string;quantity:number|string;stock_quantity_used:number|string;sale_unit:string;status:string;command_number:number|null;command_name:string|null;display_label:string }>("SELECT oi.product_id,oi.stock_pool_id,oi.product_name,oi.quantity,oi.stock_quantity_used,oi.sale_unit,oi.status,c.command_number,c.command_name,cl.display_label FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE oi.id=$1 AND oi.command_id=$2 AND c.status='OPEN' FOR UPDATE OF oi,c", [itemId, commandId]);
      const current = item.rows[0];
      if (!current || current.status === "CANCELLED") throw new Error("Item não pode ser removido.");
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1", [itemId]);
      if (Number(current.stock_quantity_used) > 0) {
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [current.stock_quantity_used, current.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'ITEM_REMOVED',$4,$5)", [current.product_id, current.stock_pool_id, current.stock_quantity_used, itemId, user.id]);
      }
      const returnDetail=Number(current.stock_quantity_used)>0?` Estoque devolvido: ${current.stock_quantity_used} ${current.sale_unit}.`:" Estoque ilimitado, sem alteração de saldo.";
      await auditLog({ userId:user.id, action:"ITEM_REMOVED", entityType:"COMMAND", entityId:commandId, description:`Removeu ${current.quantity}× ${current.product_name} da comanda ${commandLabel(current)}, ${current.display_label}.${returnDetail}`, metadata:{ commandNumber:current.command_number, commandName:current.command_name, table:current.display_label, itemId, productId:current.product_id, productName:current.product_name, quantity:current.quantity, stockPoolId:current.stock_pool_id, stockReturned:current.stock_quantity_used, stockUnit:current.sale_unit } }, client);
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
      const command = await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("A comanda não está aberta.");
      await client.query("UPDATE commands SET priority=$1,priority_note=$2,priority_updated_at=NOW(),priority_updated_by=$3 WHERE id=$4", [priority, priority ? note : null, user.id, commandId]);
      await auditLog({ userId:user.id, action:priority ? "COMMAND_PRIORITY_SET" : "COMMAND_PRIORITY_REMOVED", entityType:"COMMAND", entityId:commandId, description:priority ? `Marcou a comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}, como prioridade. Motivo: ${note}` : `Removeu a prioridade da comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}.`, metadata:{ commandNumber:command.rows[0].command_number, commandName:command.rows[0].command_name, table:command.rows[0].display_label, priority, note:priority ? note : null } }, client);
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
      const command = await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN'", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda fechada.");
      const items = await client.query<{ id:number }>("SELECT id FROM order_items WHERE command_id=$1 AND status='PENDING' AND destination='KITCHEN' FOR UPDATE", [commandId]);
      if (!items.rowCount) throw new Error("Não há novos itens da cozinha para enviar.");
      const ticket = await client.query<{ id:number }>("INSERT INTO kitchen_tickets (command_id,created_by) VALUES ($1,$2) RETURNING id", [commandId, user.id]);
      const id = ticket.rows[0].id;
      for (const item of items.rows) await client.query("INSERT INTO kitchen_ticket_items (ticket_id,order_item_id) VALUES ($1,$2)", [id, item.id]);
      await client.query("UPDATE order_items SET status='SENT',sent_at=NOW() WHERE id=ANY($1::bigint[])", [items.rows.map((item) => item.id)]);
      await auditLog({ userId:user.id, action:"KITCHEN_SENT", entityType:"KITCHEN_TICKET", entityId:id, description:`Enviou ${items.rowCount} item(ns) da comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}, para a cozinha.`, metadata:{ commandId, commandNumber:command.rows[0].command_number, commandName:command.rows[0].command_name, table:command.rows[0].display_label, itemCount:items.rowCount } }, client);
      return id;
    });
  } catch (error) { return {error:error instanceof Error ? error.message : "Não foi possível enviar o pedido."}; }
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/cozinha");
  return {url:`/imprimir/cozinha/${ticketId}?formato=${encodeURIComponent(format)}`};
}

export async function updateKitchenStatusAction(formData: FormData) {
  const user = await requirePermission("KITCHEN");
  const itemId = positiveId(formData.get("itemId"));
  const status = String(formData.get("status") ?? "");
  if (!["PREPARING","READY","DELIVERED"].includes(status)) throw new Error("Situação inválida.");
  await transaction(async (client) => {
    const item = await client.query<{ command_id:number;product_name:string;command_number:number|null;command_name:string|null;display_label:string }>("SELECT oi.command_id,oi.product_name,c.command_number,c.command_name,cl.display_label FROM order_items oi JOIN commands c ON c.id=oi.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE oi.id=$1 AND oi.destination='KITCHEN' AND oi.status<>'CANCELLED' FOR UPDATE OF oi", [itemId]);
    if (!item.rows[0]) throw new Error("Item da cozinha não encontrado.");
    const delivery=await client.query<{id:number;status:string}>("SELECT d.id,d.status FROM delivery_orders d JOIN sales s ON s.id=d.sale_id WHERE s.command_id=$1 AND d.status IN ('PREPARING','READY') FOR UPDATE OF d",[item.rows[0].command_id]);
    if(delivery.rows[0]&&status==="DELIVERED")throw new Error("Pedidos de delivery só podem ser entregues após confirmar o código na aba Delivery.");
    await client.query("UPDATE order_items SET status=$1 WHERE id=$2", [status, itemId]);
    const labels:Record<string,string> = { PREPARING:"em preparo", READY:"pronto", DELIVERED:"entregue" };
    await auditLog({ userId:user.id, action:"KITCHEN_STATUS_UPDATED", entityType:"ORDER_ITEM", entityId:itemId, description:`Marcou ${item.rows[0].product_name} da comanda ${commandLabel(item.rows[0])}, ${item.rows[0].display_label}, como ${labels[status]}.`, metadata:{ commandNumber:item.rows[0].command_number, commandName:item.rows[0].command_name, table:item.rows[0].display_label, productName:item.rows[0].product_name, status } }, client);
    if(delivery.rows[0]){
      const waiting=await client.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM order_items WHERE command_id=$1 AND destination='KITCHEN' AND status NOT IN ('READY','DELIVERED','CANCELLED')) AS waiting",[item.rows[0].command_id]);
      const nextStatus=waiting.rows[0]?.waiting?"PREPARING":"READY";
      if(delivery.rows[0].status!==nextStatus){
        await client.query("UPDATE delivery_orders SET status=$1,ready_at=CASE WHEN $1='READY' THEN NOW() ELSE NULL END,ready_by=CASE WHEN $1='READY' THEN $2 ELSE NULL END,updated_at=NOW() WHERE id=$3",[nextStatus,user.id,delivery.rows[0].id]);
        if(nextStatus==="READY") await auditLog({userId:user.id,action:"DELIVERY_READY",entityType:"DELIVERY",entityId:delivery.rows[0].id,description:`Marcou automaticamente o pedido ${deliveryOrderLabel(delivery.rows[0].id)} como pronto para retirada.`},client);
      }
    }
  });
  revalidatePath("/cozinha");
  revalidatePath("/delivery");
}

export async function closeCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  if (!canManageCommand(user.role)) return {error:"Somente Caixa, Gerente ou Administrador pode finalizar a comanda."};
  const format = String(formData.get("format") ?? "80");
  let paymentAllocations:SalePaymentAllocation[]=[];
  try{paymentAllocations=paymentAllocationsValue(formData);}catch(error){return{error:error instanceof Error?error.message:"As formas de pagamento estão inválidas."};}
  const splitCount = Math.min(50,Math.max(1, Math.trunc(numberValue(formData.get("splitCount"), 1))));
  const customerIdRaw=String(formData.get("customerId")??"").trim();
  const requestedCustomerId=customerIdRaw?Math.trunc(Number(customerIdRaw)):null;
  const createCustomer=String(formData.get("createCustomer")??"")==="1";
  const newCustomerName=String(formData.get("newCustomerName")??"").trim().replace(/\s+/g," ");
  const newCustomerCpf=cpfValue(formData.get("newCustomerCpf"));
  const newCustomerContact=String(formData.get("newCustomerContact")??"").trim();
  if(requestedCustomerId!==null&&(!Number.isSafeInteger(requestedCustomerId)||requestedCustomerId<1)) return{error:"O cliente selecionado está inválido."};
  if(createCustomer&&requestedCustomerId!==null) return{error:"Escolha um cliente cadastrado ou crie um novo cadastro."};
  if(createCustomer&&newCustomerName.length<2) return{error:"Informe o nome do cliente para criar o cadastro."};
  if(createCustomer&&newCustomerCpf.length!==11) return{error:"Informe um CPF com 11 números para criar o cadastro."};
  if(createCustomer&&newCustomerContact.length<5) return{error:"Informe o contato do cliente para criar o cadastro."};
  let saleId = 0;
  try {
    saleId = await transaction(async (client) => {
      const command = await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("Comanda não está aberta.");
      let saleCustomerId=requestedCustomerId;
      let customerCreated=false;
      if(saleCustomerId!==null){
        const selectedCustomer=await client.query<{id:number}>("SELECT id FROM customers WHERE id=$1 AND active=TRUE",[saleCustomerId]);
        if(!selectedCustomer.rows[0]) throw new Error("O cliente selecionado está inativo ou não foi encontrado.");
      }
      if(createCustomer){
        const createdCustomer=await client.query<{id:number}>("INSERT INTO customers (name,cpf,contact,created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (cpf) DO NOTHING RETURNING id",[newCustomerName,newCustomerCpf,newCustomerContact,user.id]);
        if(createdCustomer.rows[0]){
          saleCustomerId=Number(createdCustomer.rows[0].id);customerCreated=true;
          await auditLog({userId:user.id,action:"CUSTOMER_CREATED",entityType:"CUSTOMER",entityId:saleCustomerId,description:`Cadastrou o cliente ${newCustomerName} durante o fechamento de uma comanda.`,metadata:{cpf:newCustomerCpf,contact:newCustomerContact,source:"COMMAND_CLOSING"}},client);
        }else{
          const existingCustomer=await client.query<{id:number;active:boolean}>("SELECT id,active FROM customers WHERE cpf=$1",[newCustomerCpf]);
          if(!existingCustomer.rows[0]?.active) throw new Error("Já existe um cadastro inativo com esse CPF.");
          saleCustomerId=Number(existingCustomer.rows[0].id);
        }
      }
      const totalItems = await client.query<{ subtotal:string }>("SELECT COALESCE(SUM(unit_price_cents*quantity),0)::text AS subtotal FROM order_items WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      const subtotal = Math.round(Number(totalItems.rows[0]?.subtotal ?? 0));
      if (subtotal <= 0) throw new Error("A comanda não possui itens.");
      const discount = Math.min(cents(formData.get("discount")), subtotal);
      const servicePercent = Math.min(100, Math.max(0, numberValue(formData.get("servicePercent"))));
      const service = Math.round((subtotal - discount) * servicePercent / 100);
      const total = subtotal - discount + service;
      const paid = paymentAllocations.reduce((sum,payment) => sum + payment.amountCents, 0);
      if (paid !== total) throw new Error("A soma das formas de pagamento precisa ser igual ao total da conta.");
      const storeCreditTotals=new Map<number,number>();
      for(const payment of paymentAllocations) if(payment.method==="STORE_CREDIT"&&payment.customerId) storeCreditTotals.set(payment.customerId,(storeCreditTotals.get(payment.customerId)||0)+payment.amountCents);
      if(storeCreditTotals.size>1) throw new Error("Use o crédito em loja de apenas um cliente por venda.");
      if(storeCreditTotals.size===1){
        const creditCustomerId=[...storeCreditTotals.keys()][0];
        if(saleCustomerId!==null&&saleCustomerId!==creditCustomerId) throw new Error("O crédito em loja precisa pertencer ao cliente identificado na venda.");
        saleCustomerId=creditCustomerId;
      }
      if(storeCreditTotals.size>0){
        const ids=[...storeCreditTotals.keys()].sort((a,b)=>a-b);
        const customers=await client.query<{id:number;name:string;store_credit_balance_cents:number}>("SELECT id,name,store_credit_balance_cents FROM customers WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY id FOR UPDATE",[ids]);
        if(customers.rows.length!==ids.length) throw new Error("Um dos clientes com crédito não está disponível.");
        for(const customer of customers.rows){
          const required=storeCreditTotals.get(customer.id)||0;
          const balance=Number(customer.store_credit_balance_cents);
          if(required>balance) throw new Error(`O crédito disponível de ${customer.name} é ${moneyText(balance)}.`);
        }
      }
      const staffMemberIds=[...new Set(paymentAllocations.filter((payment)=>payment.method==="STAFF_VOUCHER").map((payment)=>payment.staffMemberId as number))].sort((a,b)=>a-b);
      const staffMembersById=new Map<number,string>();
      if(staffMemberIds.length>0){
        const staffMembers=await client.query<{id:number;name:string}>("SELECT id,name FROM staff_members WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY id FOR SHARE",[staffMemberIds]);
        if(staffMembers.rows.length!==staffMemberIds.length) throw new Error("Um dos funcionários selecionados não está ativo ou não foi encontrado.");
        for(const staffMember of staffMembers.rows) staffMembersById.set(Number(staffMember.id),staffMember.name);
      }
      const cash = await client.query<{ id:number }>("SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1 FOR UPDATE");
      if (!cash.rows[0]) throw new Error("Abra o caixa antes de finalizar a venda.");
      const sale = await client.query<{ id:number }>("INSERT INTO sales (command_id,cash_session_id,subtotal_cents,discount_cents,service_fee_cents,total_cents,split_count,customer_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [commandId, cash.rows[0].id, subtotal, discount, service, total, splitCount, saleCustomerId, user.id]);
      for(const payment of paymentAllocations){
        const staffMemberName=payment.staffMemberId?staffMembersById.get(payment.staffMemberId)??null:null;
        const createdPayment=await client.query<{id:number}>("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents,customer_id,staff_member_id,staff_member_name,staff_voucher_status) VALUES ($1,$2,$3,NULL,0,$4,$5,$6,$7) RETURNING id",[sale.rows[0].id,payment.method,payment.amountCents,payment.customerId??null,payment.staffMemberId??null,staffMemberName,payment.method==="STAFF_VOUCHER"?"PENDING":null]);
        if(payment.method==="STORE_CREDIT"&&payment.customerId){
          await client.query("UPDATE customers SET store_credit_balance_cents=store_credit_balance_cents-$1,updated_at=NOW() WHERE id=$2",[payment.amountCents,payment.customerId]);
          await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,sale_id,payment_id,notes,created_by) VALUES ($1,$2,'SALE_USED',$3,$4,$5,$6)",[payment.customerId,-payment.amountCents,sale.rows[0].id,createdPayment.rows[0].id,`Crédito usado na venda #${sale.rows[0].id}`,user.id]);
        }
      }
      await client.query("UPDATE commands SET status='CLOSED',closed_at=NOW() WHERE id=$1", [commandId]);
      await auditLog({ userId:user.id, action:"SALE_COMPLETED", entityType:"SALE", entityId:sale.rows[0].id, description:`Finalizou a comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}, por ${moneyText(total)}.`, metadata:{ commandId, commandNumber:command.rows[0].command_number, commandName:command.rows[0].command_name, table:command.rows[0].display_label, customerId:saleCustomerId, customerCreated, subtotal, discount, service, total, splitCount, payments:paymentAllocations.map(({method,amountCents,staffMemberId,customerId})=>({method,amountCents,staffMemberId,customerId})) } }, client);
      return sale.rows[0].id;
    });
  } catch (error) { return {error:error instanceof Error ? error.message : "Não foi possível fechar a comanda."}; }
  revalidatePath("/comandas");
  revalidatePath("/caixa");
  revalidatePath("/painel");
  revalidatePath("/pendencias");
  revalidatePath("/clientes");
  revalidatePath("/relatorios");
  return {url:`/imprimir/venda/${saleId}?formato=${encodeURIComponent(format)}`};
}

export async function quickSaleAction(formData:FormData):Promise<{url?:string;error?:string}>{
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const format=String(formData.get("format")??"80");
  const quickSaleDraftIdRaw=String(formData.get("quickSaleDraftId")??"").trim();
  const quickSaleDraftId=quickSaleDraftIdRaw?Math.trunc(Number(quickSaleDraftIdRaw)):null;
  if(quickSaleDraftId!==null&&(!Number.isSafeInteger(quickSaleDraftId)||quickSaleDraftId<1)) return{error:"A pendência de venda informada é inválida."};
  let items:QuickSaleItemInput[]=[];
  let paymentAllocations:SalePaymentAllocation[]=[];
  try{
    items=quickSaleItemsValue(formData);
    paymentAllocations=paymentAllocationsValue(formData);
  }catch(error){return{error:error instanceof Error?error.message:"Os dados da venda rápida estão inválidos."};}
  const splitCount=Math.min(50,Math.max(1,Math.trunc(numberValue(formData.get("splitCount"),1))));
  const customerIdRaw=String(formData.get("customerId")??"").trim();
  const requestedCustomerId=customerIdRaw?Math.trunc(Number(customerIdRaw)):null;
  const createCustomer=String(formData.get("createCustomer")??"")==="1";
  const newCustomerName=String(formData.get("newCustomerName")??"").trim().replace(/\s+/g," ");
  const newCustomerCpf=cpfValue(formData.get("newCustomerCpf"));
  const newCustomerContact=String(formData.get("newCustomerContact")??"").trim();
  const fulfillmentType=String(formData.get("fulfillmentType")??"COUNTER");
  if(!["COUNTER","APP_PICKUP"].includes(fulfillmentType)) return{error:"O tipo de atendimento informado é inválido."};
  let courierAppName="";
  let courierAppCode="";
  try{
    courierAppName=courierText(formData.get("courierAppName"),60);
    courierAppCode=courierText(formData.get("courierAppCode"),40);
  }catch(error){return{error:error instanceof Error?error.message:"Os dados da retirada por aplicativo estão inválidos."};}
  if(requestedCustomerId!==null&&(!Number.isSafeInteger(requestedCustomerId)||requestedCustomerId<1)) return{error:"O cliente selecionado está inválido."};
  if(createCustomer&&requestedCustomerId!==null) return{error:"Escolha um cliente cadastrado ou crie um novo cadastro."};
  if(createCustomer&&newCustomerName.length<2) return{error:"Informe o nome do cliente para criar o cadastro."};
  if(createCustomer&&newCustomerCpf.length!==11) return{error:"Informe um CPF com 11 números para criar o cadastro."};
  if(createCustomer&&newCustomerContact.length<5) return{error:"Informe o contato do cliente para criar o cadastro."};

  let saleId=0;
  try{
    saleId=await transaction(async(client)=>{
      if(quickSaleDraftId!==null){
        const pendingDraft=await client.query<{id:number}>("SELECT id FROM quick_sale_pending_orders WHERE id=$1 FOR UPDATE",[quickSaleDraftId]);
        if(!pendingDraft.rows[0]) throw new Error("Essa pendência de venda não existe mais ou já foi finalizada.");
      }
      let saleCustomerId=requestedCustomerId;
      let saleCustomerName:string|null=null;
      let customerCreated=false;
      if(saleCustomerId!==null){
        const selectedCustomer=await client.query<{id:number;name:string}>("SELECT id,name FROM customers WHERE id=$1 AND active=TRUE FOR SHARE",[saleCustomerId]);
        if(!selectedCustomer.rows[0]) throw new Error("O cliente selecionado está inativo ou não foi encontrado.");
        saleCustomerName=selectedCustomer.rows[0].name;
      }
      if(createCustomer){
        const createdCustomer=await client.query<{id:number;name:string}>("INSERT INTO customers (name,cpf,contact,created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (cpf) DO NOTHING RETURNING id,name",[newCustomerName,newCustomerCpf,newCustomerContact,user.id]);
        if(createdCustomer.rows[0]){
          saleCustomerId=Number(createdCustomer.rows[0].id);saleCustomerName=createdCustomer.rows[0].name;customerCreated=true;
          await auditLog({userId:user.id,action:"CUSTOMER_CREATED",entityType:"CUSTOMER",entityId:saleCustomerId,description:`Cadastrou o cliente ${newCustomerName} durante uma venda rápida.`,metadata:{cpf:newCustomerCpf,contact:newCustomerContact,source:"QUICK_SALE"}},client);
        }else{
          const existingCustomer=await client.query<{id:number;name:string;active:boolean}>("SELECT id,name,active FROM customers WHERE cpf=$1",[newCustomerCpf]);
          if(!existingCustomer.rows[0]?.active) throw new Error("Já existe um cadastro inativo com esse CPF.");
          saleCustomerId=Number(existingCustomer.rows[0].id);saleCustomerName=existingCustomer.rows[0].name;
        }
      }

      const productIds=items.map((item)=>item.productId);
      const products=await client.query<{id:number;name:string;price_cents:number;cost_cents:number;stock_pool_id:number;stock_quantity:number|string;stock_unlimited:boolean;destination:string;sale_unit:string;stock_per_sale_unit:number|string}>(`SELECT p.id,p.name,p.price_cents,p.cost_cents,p.stock_pool_id,sp.stock_quantity,sp.unlimited AS stock_unlimited,p.destination,p.sale_unit,p.stock_per_sale_unit
        FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id
        WHERE p.id=ANY($1::bigint[]) AND p.active=TRUE AND p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%'
        ORDER BY sp.id,p.id FOR UPDATE OF p,sp`,[productIds]);
      if(products.rows.length!==items.length) throw new Error("Um dos produtos não está mais disponível. Atualize a página e tente novamente.");
      const quantitiesByProduct=new Map(items.map((item)=>[item.productId,item.quantity]));
      const requiredByPool=new Map<number,number>();
      const poolAvailability=new Map<number,{quantity:number;unlimited:boolean;unit:string}>();
      let subtotal=0;
      for(const product of products.rows){
        const quantity=quantitiesByProduct.get(Number(product.id))||0;
        const factor=Number(product.stock_per_sale_unit);
        if(!Number.isFinite(factor)||factor<=0) throw new Error(`O controle de estoque de ${product.name} está inválido.`);
        const stockUsed=product.stock_unlimited?0:Math.round(quantity*factor*1000)/1000;
        subtotal+=Number(product.price_cents)*quantity;
        requiredByPool.set(Number(product.stock_pool_id),Math.round(((requiredByPool.get(Number(product.stock_pool_id))||0)+stockUsed)*1000)/1000);
        poolAvailability.set(Number(product.stock_pool_id),{quantity:Number(product.stock_quantity),unlimited:product.stock_unlimited,unit:product.sale_unit});
      }
      subtotal=Math.round(subtotal);
      if(subtotal<=0) throw new Error("A venda rápida precisa ter valor maior que zero.");
      for(const [poolId,required] of requiredByPool){
        const pool=poolAvailability.get(poolId);
        if(!pool) throw new Error("O controle de estoque de um dos produtos está inválido.");
        if(!pool.unlimited&&required>pool.quantity) throw new Error(`Estoque insuficiente para concluir a venda. Disponível: ${pool.quantity} ${pool.unit}.`);
      }

      const discount=Math.min(cents(formData.get("discount")),subtotal);
      const servicePercent=Math.min(100,Math.max(0,numberValue(formData.get("servicePercent"))));
      const service=Math.round((subtotal-discount)*servicePercent/100);
      const total=subtotal-discount+service;
      if(total>2147483647) throw new Error("O valor total da venda ultrapassa o limite permitido.");
      const paid=paymentAllocations.reduce((sum,payment)=>sum+payment.amountCents,0);
      if(paid!==total) throw new Error(`A soma das formas de pagamento precisa ser ${moneyText(total)}. Revise os valores ou atualize a página.`);

      const storeCreditTotals=new Map<number,number>();
      for(const payment of paymentAllocations) if(payment.method==="STORE_CREDIT"&&payment.customerId) storeCreditTotals.set(payment.customerId,(storeCreditTotals.get(payment.customerId)||0)+payment.amountCents);
      if(storeCreditTotals.size>1) throw new Error("Use o crédito em loja de apenas um cliente por venda.");
      if(storeCreditTotals.size===1){
        const creditCustomerId=[...storeCreditTotals.keys()][0];
        if(saleCustomerId!==null&&saleCustomerId!==creditCustomerId) throw new Error("O crédito em loja precisa pertencer ao cliente identificado na venda.");
        saleCustomerId=creditCustomerId;
      }
      if(storeCreditTotals.size>0){
        const ids=[...storeCreditTotals.keys()].sort((a,b)=>a-b);
        const customers=await client.query<{id:number;name:string;store_credit_balance_cents:number}>("SELECT id,name,store_credit_balance_cents FROM customers WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY id FOR UPDATE",[ids]);
        if(customers.rows.length!==ids.length) throw new Error("O cliente com crédito não está disponível.");
        for(const customer of customers.rows){
          const required=storeCreditTotals.get(Number(customer.id))||0;
          const balance=Number(customer.store_credit_balance_cents);
          if(required>balance) throw new Error(`O crédito disponível de ${customer.name} é ${moneyText(balance)}.`);
          if(Number(customer.id)===saleCustomerId) saleCustomerName=customer.name;
        }
      }

      const staffMemberIds=[...new Set(paymentAllocations.filter((payment)=>payment.method==="STAFF_VOUCHER").map((payment)=>payment.staffMemberId as number))].sort((a,b)=>a-b);
      const staffMembersById=new Map<number,string>();
      if(staffMemberIds.length>0){
        const staffMembers=await client.query<{id:number;name:string}>("SELECT id,name FROM staff_members WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY id FOR SHARE",[staffMemberIds]);
        if(staffMembers.rows.length!==staffMemberIds.length) throw new Error("Um dos funcionários selecionados não está ativo ou não foi encontrado.");
        for(const staffMember of staffMembers.rows) staffMembersById.set(Number(staffMember.id),staffMember.name);
      }
      const cash=await client.query<{id:number}>("SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1 FOR UPDATE");
      if(!cash.rows[0]) throw new Error("Abra o caixa antes de finalizar a venda rápida.");

      const command=await client.query<{id:number}>("INSERT INTO commands (command_number,command_name,table_id,customer_name,status,opened_by,opened_at,closed_at,notes,sale_channel) VALUES (NULL,'Venda rápida',NULL,$1,'CLOSED',$2,NOW(),NOW(),'Venda concluída diretamente no caixa.','QUICK_SALE') RETURNING id",[saleCustomerName,user.id]);
      const commandId=Number(command.rows[0].id);
      const kitchenItemIds:number[]=[];
      for(const product of products.rows){
        const quantity=quantitiesByProduct.get(Number(product.id))||0;
        const stockUsed=product.stock_unlimited?0:Math.round(quantity*Number(product.stock_per_sale_unit)*1000)/1000;
        const status=product.destination==="KITCHEN"?"SENT":"DELIVERED";
        const inserted=await client.query<{id:number}>(`INSERT INTO order_items (command_id,product_id,stock_pool_id,product_name,unit_price_cents,unit_cost_cents,quantity,stock_quantity_used,destination,sale_unit,display_unit,added_by,status,sent_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UNIT',$11,$12,CASE WHEN $12='SENT' THEN NOW() ELSE NULL END) RETURNING id`,[commandId,product.id,product.stock_pool_id,product.name,product.price_cents,product.cost_cents,quantity,stockUsed,product.destination,product.sale_unit,user.id,status]);
        const orderItemId=Number(inserted.rows[0].id);
        if(status==="SENT") kitchenItemIds.push(orderItemId);
        if(!product.stock_unlimited&&stockUsed>0) await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'QUICK_SALE',$4,$5)",[product.id,product.stock_pool_id,-stockUsed,orderItemId,user.id]);
      }
      for(const [poolId,required] of requiredByPool) if(required>0&&!poolAvailability.get(poolId)?.unlimited) await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2",[required,poolId]);
      if(kitchenItemIds.length>0){
        const ticket=await client.query<{id:number}>("INSERT INTO kitchen_tickets (command_id,created_by) VALUES ($1,$2) RETURNING id",[commandId,user.id]);
        for(const orderItemId of kitchenItemIds) await client.query("INSERT INTO kitchen_ticket_items (ticket_id,order_item_id) VALUES ($1,$2)",[ticket.rows[0].id,orderItemId]);
      }

      const sale=await client.query<{id:number}>("INSERT INTO sales (command_id,cash_session_id,subtotal_cents,discount_cents,service_fee_cents,total_cents,split_count,customer_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[commandId,cash.rows[0].id,subtotal,discount,service,total,splitCount,saleCustomerId,user.id]);
      for(const payment of paymentAllocations){
        const staffMemberName=payment.staffMemberId?staffMembersById.get(payment.staffMemberId)??null:null;
        const createdPayment=await client.query<{id:number}>("INSERT INTO payments (sale_id,method,amount_cents,received_cents,change_cents,customer_id,staff_member_id,staff_member_name,staff_voucher_status) VALUES ($1,$2,$3,NULL,0,$4,$5,$6,$7) RETURNING id",[sale.rows[0].id,payment.method,payment.amountCents,payment.customerId??null,payment.staffMemberId??null,staffMemberName,payment.method==="STAFF_VOUCHER"?"PENDING":null]);
        if(payment.method==="STORE_CREDIT"&&payment.customerId){
          await client.query("UPDATE customers SET store_credit_balance_cents=store_credit_balance_cents-$1,updated_at=NOW() WHERE id=$2",[payment.amountCents,payment.customerId]);
          await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,sale_id,payment_id,notes,created_by) VALUES ($1,$2,'SALE_USED',$3,$4,$5,$6)",[payment.customerId,-payment.amountCents,sale.rows[0].id,createdPayment.rows[0].id,`Crédito usado na venda rápida #${sale.rows[0].id}`,user.id]);
        }
      }
      let deliveryId:number|null=null;
      if(fulfillmentType==="APP_PICKUP"){
        const initialStatus=kitchenItemIds.length>0?"PREPARING":"READY";
        for(let attempt=0;attempt<40;attempt+=1){
          const pickupCode=randomInt(0,10000).toString().padStart(4,"0");
          const createdDelivery=await client.query<{id:number}>(`INSERT INTO delivery_orders (sale_id,pickup_code,courier_app_name,courier_app_code,status,created_by,ready_at,ready_by)
            VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,CASE WHEN $5='READY' THEN NOW() ELSE NULL END,CASE WHEN $5='READY' THEN $6 ELSE NULL END)
            ON CONFLICT DO NOTHING RETURNING id`,[sale.rows[0].id,pickupCode,courierAppName,courierAppCode,initialStatus,user.id]);
          if(createdDelivery.rows[0]){deliveryId=Number(createdDelivery.rows[0].id);break;}
        }
        if(deliveryId===null)throw new Error("Não foi possível gerar um código de retirada. Tente finalizar novamente.");
        await auditLog({userId:user.id,action:"DELIVERY_ORDER_CREATED",entityType:"DELIVERY",entityId:deliveryId,description:`Criou o pedido ${deliveryOrderLabel(deliveryId)} para retirada por aplicativo.`,metadata:{saleId:Number(sale.rows[0].id),commandId,status:initialStatus,hasCourierAppCode:Boolean(courierAppCode),courierAppName:courierAppName||null}},client);
      }
      await auditLog({userId:user.id,action:"QUICK_SALE_COMPLETED",entityType:"SALE",entityId:sale.rows[0].id,description:`Finalizou a venda rápida #${sale.rows[0].id} por ${moneyText(total)}.`,metadata:{commandId,customerId:saleCustomerId,customerCreated,subtotal,discount,service,total,splitCount,kitchenItems:kitchenItemIds.length,fulfillmentType,deliveryId,items:products.rows.map((product)=>({productId:Number(product.id),productName:product.name,quantity:quantitiesByProduct.get(Number(product.id))||0})),payments:paymentAllocations.map(({method,amountCents,staffMemberId,customerId})=>({method,amountCents,staffMemberId,customerId}))}},client);
      if(quickSaleDraftId!==null) await client.query("DELETE FROM quick_sale_pending_orders WHERE id=$1",[quickSaleDraftId]);
      await client.query("DELETE FROM quick_sale_drafts WHERE user_id=$1",[user.id]);
      return Number(sale.rows[0].id);
    });
  }catch(error){return{error:error instanceof Error?error.message:"Não foi possível concluir a venda rápida."};}

  revalidatePath("/venda-rapida");
  revalidatePath("/pendencias-venda");
  revalidatePath("/caixa");
  revalidatePath("/painel");
  revalidatePath("/estoque");
  revalidatePath("/cozinha");
  revalidatePath("/pendencias");
  revalidatePath("/clientes");
  revalidatePath("/relatorios");
  revalidatePath("/manutencao-movimento");
  revalidatePath("/delivery");
  return{url:`/imprimir/venda/${saleId}?formato=${encodeURIComponent(format)}`};
}

export async function saveDeliveryAppCodeAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const deliveryId=positiveId(formData.get("deliveryId"));
  let courierAppName="";
  let courierAppCode="";
  try{
    courierAppName=courierText(formData.get("courierAppName"),60);
    courierAppCode=courierText(formData.get("courierAppCode"),40);
  }catch(error){fail("/delivery",error instanceof Error?error.message:"Os dados do aplicativo estão inválidos.");}
  try{
    await transaction(async(client)=>{
      const updated=await client.query<{id:number}>("UPDATE delivery_orders SET courier_app_name=NULLIF($1,''),courier_app_code=NULLIF($2,''),updated_at=NOW() WHERE id=$3 AND status IN ('PREPARING','READY') RETURNING id",[courierAppName,courierAppCode,deliveryId]);
      if(!updated.rows[0])throw new Error("Esse pedido não está mais disponível para alteração.");
      await auditLog({userId:user.id,action:"DELIVERY_APP_CODE_UPDATED",entityType:"DELIVERY",entityId:deliveryId,description:`Atualizou os dados do motoboy no pedido ${deliveryOrderLabel(deliveryId)}.`,metadata:{courierAppName:courierAppName||null,hasCourierAppCode:Boolean(courierAppCode)}},client);
    });
  }catch(error){fail("/delivery",error instanceof Error?error.message:"Não foi possível salvar o código do aplicativo.");}
  revalidatePath("/delivery");
  redirect(`/delivery?codigo=salvo&pedido=${deliveryId}`);
}

export async function confirmDeliveryPickupAction(formData:FormData){
  const user=await requireRole(["ADMIN","MANAGER","CASHIER"]);
  const deliveryId=positiveId(formData.get("deliveryId"));
  const pickupCode=String(formData.get("pickupCode")??"").trim();
  if(!/^\d{4}$/.test(pickupCode))fail("/delivery","Digite exatamente os 4 números informados pelo motoboy.");
  const result=await transaction(async(client)=>{
    const reference=await client.query<{command_id:number}>("SELECT s.command_id FROM delivery_orders d JOIN sales s ON s.id=d.sale_id WHERE d.id=$1",[deliveryId]);
    if(!reference.rows[0])return{success:false,error:"Pedido de delivery não encontrado."};
    const items=await client.query<{destination:string;status:string}>("SELECT destination,status FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' ORDER BY id FOR UPDATE",[reference.rows[0].command_id]);
    const delivery=await client.query<{id:number;pickup_code:string;courier_app_code:string|null;status:string;failed_attempts:number;locked:boolean;sale_id:number}>(`SELECT d.id,d.pickup_code,d.courier_app_code,d.status,d.failed_attempts,d.sale_id,
      (d.failed_attempts>=5 AND d.last_failed_at>NOW()-INTERVAL '5 minutes') AS locked
      FROM delivery_orders d JOIN sales s ON s.id=d.sale_id WHERE d.id=$1 AND s.status='COMPLETED' FOR UPDATE OF d`,[deliveryId]);
    const order=delivery.rows[0];
    if(!order)return{success:false,error:"Esse pedido foi cancelado ou não existe mais."};
    if(order.status!=="READY")return{success:false,error:order.status==="PREPARING"?"O pedido ainda está em preparo.":"Esse pedido já foi retirado ou cancelado."};
    const kitchenStillPreparing=items.rows.some((item)=>item.destination==="KITCHEN"&&!['READY','DELIVERED'].includes(item.status));
    if(kitchenStillPreparing){
      await client.query("UPDATE delivery_orders SET status='PREPARING',ready_at=NULL,ready_by=NULL,updated_at=NOW() WHERE id=$1",[deliveryId]);
      return{success:false,error:"Ainda existem itens da cozinha em preparo. A retirada não foi autorizada."};
    }
    if(!order.courier_app_code)return{success:false,error:"Salve primeiro o código do aplicativo informado pelo cliente."};
    if(order.locked)return{success:false,error:"Muitas tentativas incorretas. Aguarde 5 minutos antes de tentar novamente."};
    if(order.pickup_code!==pickupCode){
      const failed=await client.query<{failed_attempts:number}>(`UPDATE delivery_orders SET failed_attempts=CASE WHEN last_failed_at IS NULL OR last_failed_at<NOW()-INTERVAL '5 minutes' THEN 1 ELSE failed_attempts+1 END,last_failed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING failed_attempts`,[deliveryId]);
      await auditLog({userId:user.id,action:"DELIVERY_PICKUP_CODE_FAILED",entityType:"DELIVERY",entityId:deliveryId,description:`Recusou a retirada do pedido ${deliveryOrderLabel(deliveryId)} porque o código não conferiu.`,metadata:{attempt:Number(failed.rows[0]?.failed_attempts??1)}},client);
      return{success:false,error:"O código não confere. A retirada não foi autorizada."};
    }
    await client.query("UPDATE delivery_orders SET status='COLLECTED',collected_at=NOW(),collected_by=$1,failed_attempts=0,last_failed_at=NULL,updated_at=NOW() WHERE id=$2",[user.id,deliveryId]);
    await client.query("UPDATE order_items SET status='DELIVERED' WHERE command_id=$1 AND destination='KITCHEN' AND status IN ('READY','DELIVERED')",[reference.rows[0].command_id]);
    await auditLog({userId:user.id,action:"DELIVERY_COLLECTED",entityType:"DELIVERY",entityId:deliveryId,description:`Confirmou o código e liberou a retirada do pedido ${deliveryOrderLabel(deliveryId)}.`,metadata:{saleId:Number(order.sale_id)}},client);
    return{success:true,error:""};
  });
  if(!result.success)fail("/delivery",result.error);
  revalidatePath("/delivery");
  revalidatePath("/cozinha");
  redirect(`/delivery?retirada=confirmada&pedido=${deliveryId}`);
}

export async function cancelCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandId = positiveId(formData.get("commandId"));
  if (!canManageCommand(user.role)) fail(`/comandas/${commandId}`, "Somente Caixa, Gerente ou Administrador pode cancelar a comanda.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) fail(`/comandas/${commandId}`, "Informe o motivo do cancelamento.");
  try {
    await transaction(async (client) => {
      const command = await client.query<CommandAuditRecord>("SELECT c.command_number,c.command_name,cl.display_label FROM commands c JOIN command_locations cl ON cl.command_id=c.id WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c", [commandId]);
      if (!command.rows[0]) throw new Error("A comanda não está aberta.");
      const items = await client.query<{ id:number;product_id:number;stock_pool_id:number;stock_quantity_used:number|string }>("SELECT id,product_id,stock_pool_id,stock_quantity_used FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' FOR UPDATE", [commandId]);
      for (const item of items.rows) {
        if (Number(item.stock_quantity_used) <= 0) continue;
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.stock_quantity_used, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'COMMAND_CANCELLED',$4,$5)", [item.product_id, item.stock_pool_id, item.stock_quantity_used, item.id, user.id]);
      }
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE command_id=$1 AND status<>'CANCELLED'", [commandId]);
      await client.query("UPDATE commands SET status='CANCELLED',closed_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3", [user.id, reason, commandId]);
      await auditLog({ userId:user.id, action:"COMMAND_CANCELLED", entityType:"COMMAND", entityId:commandId, description:`Cancelou a comanda ${commandLabel(command.rows[0])}, ${command.rows[0].display_label}. Motivo: ${reason}`, metadata:{ commandNumber:command.rows[0].command_number, commandName:command.rows[0].command_name, table:command.rows[0].display_label, reason, returnedItems:items.rowCount } }, client);
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
  const cost = cents(formData.get("cost"));
  const unlimited = stockMode === "UNLIMITED";
  const stock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("stock")));
  const minStock = unlimited ? 0 : Math.max(0, quantityValue(formData.get("minStock")));
  if (!name || !category || !["OWN","DRAFT_BEER","DRAFT_WINE","UNLIMITED"].includes(stockMode) || !["KITCHEN","BAR","DIRECT"].includes(destination) || !["UNIT","KG","L","PORTION","DOSE","BOTTLE","CAN"].includes(saleUnit)) fail("/produtos", "Preencha os dados do produto.");
  let image:null|{data:Buffer;mime:string}=null;
  let stockPerSaleUnit = 1;
  try {
    if(isDraft){
      const milliliters=Math.trunc(numberValue(formData.get("servingMilliliters")));
      if(![190,300,500].includes(milliliters)) throw new Error("Escolha o tamanho de 190 ml, 300 ml ou 500 ml.");
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
      const created = await client.query<{ id:number }>("INSERT INTO products (name,category,cost_cents,price_cents,stock_quantity,min_stock,destination,sale_unit,stock_per_sale_unit,stock_pool_id,image_data,image_mime,image_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $11::bytea IS NULL THEN NULL ELSE NOW() END) RETURNING id", [name, category, cost, price, effectiveStock, effectiveMinStock, destination, saleUnit, stockPerSaleUnit, stockPoolId, image?.data??null, image?.mime??null]);
      await auditLog({ userId:user.id, action:"PRODUCT_CREATED", entityType:"PRODUCT", entityId:created.rows[0].id, description:`Cadastrou o produto ${name} com custo de ${moneyText(cost)} e venda por ${moneyText(price)}.${stockDescription}`, metadata:{ category, cost, price, stock:effectiveStock, minStock:effectiveMinStock, unlimited:effectiveUnlimited, stockMode, stockPoolId, destination, saleUnit, stockPerSaleUnit, hasImage:Boolean(image) } }, client);
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
  const cost = cents(formData.get("cost"));
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
      if(![190,300,500].includes(milliliters)) throw new Error("Escolha o tamanho de 190 ml, 300 ml ou 500 ml.");
      stockPerSaleUnit=milliliters/1000;
    }else stockPerSaleUnit = stockPerSaleUnitValue(formData.get("stockPerSaleUnit"), name, saleUnit);
  }
  catch(error) { fail(`/produtos/${productId}`, error instanceof Error ? error.message : "Revise o controle de estoque."); }
  try { image=await readProductImage(formData.get("image")); }
  catch(error){ fail(`/produtos/${productId}`,error instanceof Error?error.message:"Não foi possível processar a foto."); }
  try {
    await transaction(async (client) => {
      const current = await client.query<{name:string;price_cents:number;cost_cents:number;stock_per_sale_unit:number|string;stock_pool_id:number;stock_kind:string|null;stock_quantity:number|string;min_stock:number|string;stock_unlimited:boolean;stock_sale_unit:string;pool_members:string}>(`SELECT p.name,p.price_cents,p.cost_cents,p.stock_per_sale_unit,p.stock_pool_id,sp.stock_kind,sp.stock_quantity,sp.min_stock,sp.unlimited AS stock_unlimited,sp.sale_unit AS stock_sale_unit,
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
      await client.query(`UPDATE products SET name=$1,category=$2,cost_cents=$3,price_cents=$4,stock_quantity=$5,min_stock=$6,destination=$7,sale_unit=$8,stock_per_sale_unit=$9,stock_pool_id=$10,active=$11,
        image_data=CASE WHEN $12::boolean THEN NULL WHEN $13::bytea IS NOT NULL THEN $13 ELSE image_data END,
        image_mime=CASE WHEN $12::boolean THEN NULL WHEN $13::bytea IS NOT NULL THEN $14 ELSE image_mime END,
        image_updated_at=CASE WHEN $12::boolean THEN NOW() WHEN $13::bytea IS NOT NULL THEN NOW() ELSE image_updated_at END,updated_at=NOW() WHERE id=$15`,
        [name,category,cost,price,effectiveStock,effectiveMinStock,destination,saleUnit,stockPerSaleUnit,stockPoolId,active,removeImage,image?.data??null,image?.mime??null,productId]);
      if(cost>0) await client.query("UPDATE order_items SET unit_cost_cents=$1 WHERE product_id=$2 AND unit_cost_cents=0",[cost,productId]);
      await auditLog({userId:user.id,action:"PRODUCT_UPDATED",entityType:"PRODUCT",entityId:productId,description:`Atualizou o produto ${old.name}: custo ${moneyText(old.cost_cents)} → ${moneyText(cost)}; venda ${moneyText(old.price_cents)} → ${moneyText(price)}.${stockDescription}`,metadata:{name,category,cost,price,stock:effectiveStock,minStock:effectiveMinStock,unlimited:effectiveUnlimited,stockMode,stockPoolId,destination,saleUnit,stockPerSaleUnit,previousStockFactor:old.stock_per_sale_unit,active,imageChanged:Boolean(image)||removeImage}},client);
    });
  } catch(error){ fail(`/produtos/${productId}`,error instanceof Error?error.message:"Não foi possível atualizar o produto."); }
  revalidatePath("/produtos"); revalidatePath(`/produtos/${productId}`); revalidatePath("/estoque"); revalidatePath("/comandas");
  redirect("/produtos");
}

export async function updateProductFinancialsAction(formData:FormData){
  const user=await requirePermission("FINANCE");
  const productId=positiveId(formData.get("productId"));
  const cost=cents(formData.get("cost"));
  const price=cents(formData.get("price"));
  if(cost>0&&price===0) fail("/financeiro","O preço de venda deve ser maior que zero quando há custo cadastrado.");
  try{
    await transaction(async(client)=>{
      const current=await client.query<{name:string;cost_cents:number;price_cents:number}>("SELECT name,cost_cents,price_cents FROM products WHERE id=$1 AND deleted_at IS NULL AND name NOT ILIKE '%ESTOQUE%' FOR UPDATE",[productId]);
      if(!current.rows[0]) throw new Error("Produto não encontrado.");
      const previous=current.rows[0];
      await client.query("UPDATE products SET cost_cents=$1,price_cents=$2,updated_at=NOW() WHERE id=$3",[cost,price,productId]);
      if(cost>0) await client.query("UPDATE order_items SET unit_cost_cents=$1 WHERE product_id=$2 AND unit_cost_cents=0",[cost,productId]);
      const margin=price>0?Math.round(((price-cost)/price)*10000)/100:0;
      await auditLog({userId:user.id,action:"PRODUCT_FINANCE_UPDATED",entityType:"PRODUCT",entityId:productId,description:`Atualizou ${previous.name}: custo ${moneyText(previous.cost_cents)} → ${moneyText(cost)}; venda ${moneyText(previous.price_cents)} → ${moneyText(price)}; margem ${margin.toFixed(2)}%.`,metadata:{previousCost:previous.cost_cents,cost,previousPrice:previous.price_cents,price,margin}},client);
    });
  }catch(error){fail("/financeiro",error instanceof Error?error.message:"Não foi possível atualizar os valores do produto.");}
  revalidatePath("/financeiro");revalidatePath("/produtos");revalidatePath(`/produtos/${productId}`);revalidatePath("/comandas");
  redirect("/financeiro?sucesso=produto");
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

export async function adjustStockAction(formData: FormData) {
  const user = await requirePermission("STOCK");
  const productId = positiveId(formData.get("productId"));
  const movementType = String(formData.get("movementType") ?? "");
  const amount = Math.abs(quantityValue(formData.get("quantity")));
  if (!["ENTRY","EXIT"].includes(movementType)) fail("/estoque", "Escolha entrada ou saída de estoque.");
  if (amount === 0) fail("/estoque", "Informe uma quantidade maior que zero.");
  const quantity = movementType === "EXIT" ? -amount : amount;
  try {
    await transaction(async (client) => {
      const current = await client.query<{ name:string;stock_pool_id:number;stock_quantity:number|string;unlimited:boolean;sale_unit:string }>("SELECT p.name,p.stock_pool_id,sp.stock_quantity,sp.unlimited,sp.sale_unit FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p,sp", [productId]);
      if (!current.rows[0]) throw new Error("Produto não encontrado.");
      if (current.rows[0].unlimited) throw new Error("Produtos com estoque ilimitado não recebem ajuste de saldo.");
      if (Number(current.rows[0].stock_quantity) + quantity < 0) throw new Error("O ajuste deixaria o estoque negativo.");
      const newStock = Number(current.rows[0].stock_quantity) + quantity;
      await client.query("UPDATE stock_pools SET stock_quantity=$1,updated_at=NOW() WHERE id=$2", [newStock, current.rows[0].stock_pool_id]);
      await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,user_id) VALUES ($1,$2,$3,'MANUAL_ADJUSTMENT',$4)", [productId, current.rows[0].stock_pool_id, quantity, user.id]);
      await auditLog({ userId:user.id, action:"STOCK_ADJUSTED", entityType:"STOCK_POOL", entityId:current.rows[0].stock_pool_id, description:`Registrou ${movementType === "ENTRY" ? "entrada" : "saída"} de ${amount} ${current.rows[0].sale_unit} no estoque de ${current.rows[0].name}. Novo saldo: ${newStock} ${current.rows[0].sale_unit}.`, metadata:{ productId,stockPoolId:current.rows[0].stock_pool_id,movementType,quantity,previousStock:current.rows[0].stock_quantity,newStock,saleUnit:current.rows[0].sale_unit } }, client);
    });
  } catch (error) { fail("/estoque", error instanceof Error ? error.message : "Não foi possível ajustar o estoque."); }
  revalidatePath("/estoque"); revalidatePath("/produtos"); revalidatePath("/comandas"); revalidatePath("/painel");
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
  const requestedReturnTo=String(formData.get("returnTo")??"");
  const returnTo=requestedReturnTo===`/configuracoes/usuarios/${userId}`?requestedReturnTo:"/configuracoes";
  const selected = [...new Set(formData.getAll("permissions").map(String).filter(isPermission))];
  try {
    await transaction(async (client) => {
      const target = await client.query<{ name:string;role:Role }>("SELECT name,role FROM users WHERE id=$1 AND active=TRUE FOR UPDATE", [userId]);
      if (!target.rows[0]) throw new Error("Funcionário não encontrado.");
      if (target.rows[0].role === "ADMIN") throw new Error("O acesso de Administradores é sempre completo.");
      if (actor.role === "MANAGER" && target.rows[0].role === "MANAGER") throw new Error("Somente Administradores podem alterar outro Gerente.");
      const allowed = isManagementRole(target.rows[0].role) ? selected : selected.filter((permission) => !["CASH","FINANCE","REPORTS"].includes(permission));
      await client.query("DELETE FROM user_permissions WHERE user_id=$1", [userId]);
      for (const permission of allowed) await client.query("INSERT INTO user_permissions (user_id,permission) VALUES ($1,$2)", [userId, permission]);
      const labels = permissionConfig.filter((item) => allowed.includes(item.key)).map((item) => item.label);
      await auditLog({ userId:actor.id, action:"PERMISSIONS_UPDATED", entityType:"USER", entityId:userId, description:`Atualizou os acessos de ${target.rows[0].name}: ${labels.length ? labels.join(", ") : "sem módulos operacionais"}.`, metadata:{ permissions:allowed } }, client);
    });
  } catch (error) { fail(returnTo, error instanceof Error ? error.message : "Não foi possível atualizar os acessos."); }
  revalidatePath("/configuracoes"); revalidatePath(`/configuracoes/usuarios/${userId}`);
  redirect(`${returnTo}?sucesso=permissoes`);
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
      const sale = await client.query<{ command_id:number;status:string;total_cents:number;command_number:number|null;command_name:string|null;sale_channel:string;display_label:string }>("SELECT s.command_id,s.status,s.total_cents,c.command_number,c.command_name,c.sale_channel,cl.display_label FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id WHERE s.id=$1 FOR UPDATE OF s", [saleId]);
      if (!sale.rows[0] || sale.rows[0].status !== "COMPLETED") throw new Error("Venda não pode ser cancelada.");
      const items = await client.query<{ id:number;product_id:number;stock_pool_id:number;stock_quantity_used:number|string }>("SELECT id,product_id,stock_pool_id,stock_quantity_used FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' FOR UPDATE", [sale.rows[0].command_id]);
      for (const item of items.rows) {
        if (Number(item.stock_quantity_used) <= 0) continue;
        await client.query("UPDATE stock_pools SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2", [item.stock_quantity_used, item.stock_pool_id]);
        await client.query("INSERT INTO stock_movements (product_id,stock_pool_id,quantity,reason,order_item_id,user_id) VALUES ($1,$2,$3,'SALE_CANCELLED',$4,$5)", [item.product_id, item.stock_pool_id, item.stock_quantity_used, item.id, user.id]);
      }
      await client.query("UPDATE order_items SET status='CANCELLED',cancelled_at=NOW() WHERE command_id=$1 AND status<>'CANCELLED'",[sale.rows[0].command_id]);
      const storeCredits=await client.query<{id:number;customer_id:number;amount_cents:number}>("SELECT id,customer_id,amount_cents FROM payments WHERE sale_id=$1 AND method='STORE_CREDIT' AND customer_id IS NOT NULL AND voided_at IS NULL ORDER BY customer_id,id FOR UPDATE",[saleId]);
      for(const payment of storeCredits.rows){
        await client.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE",[payment.customer_id]);
        await client.query("UPDATE customers SET store_credit_balance_cents=store_credit_balance_cents+$1,updated_at=NOW() WHERE id=$2",[payment.amount_cents,payment.customer_id]);
        await client.query("INSERT INTO customer_credit_movements (customer_id,amount_cents,movement_type,sale_id,payment_id,notes,created_by) VALUES ($1,$2,'SALE_REFUNDED',$3,$4,$5,$6)",[payment.customer_id,payment.amount_cents,saleId,payment.id,`Crédito devolvido pelo cancelamento da venda #${saleId}`,user.id]);
      }
      await client.query("UPDATE payments SET staff_voucher_status='CANCELLED' WHERE sale_id=$1 AND method='STAFF_VOUCHER' AND staff_voucher_status='PENDING' AND voided_at IS NULL",[saleId]);
      await client.query("UPDATE sales SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),cancellation_reason=$2 WHERE id=$3", [user.id, reason, saleId]);
      await client.query("UPDATE commands SET status='CANCELLED',cancelled_by=$1,cancellation_reason=$2,closed_at=COALESCE(closed_at,NOW()) WHERE id=$3", [user.id,reason,sale.rows[0].command_id]);
      const cancelledDelivery=await client.query<{id:number}>("UPDATE delivery_orders SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),updated_at=NOW() WHERE sale_id=$2 AND status<>'CANCELLED' RETURNING id",[user.id,saleId]);
      if(cancelledDelivery.rows[0])await auditLog({userId:user.id,action:"DELIVERY_CANCELLED",entityType:"DELIVERY",entityId:cancelledDelivery.rows[0].id,description:`Cancelou o pedido ${deliveryOrderLabel(cancelledDelivery.rows[0].id)} junto com a venda #${saleId}.`,metadata:{saleId,reason}},client);
      await auditLog({ userId:user.id, action:"SALE_CANCELLED", entityType:"SALE", entityId:saleId, description:`Cancelou a venda #${saleId}, ${saleReferenceLabel({...sale.rows[0],table_display:sale.rows[0].display_label})}, de ${moneyText(Number(sale.rows[0].total_cents))}. Motivo: ${reason}`, metadata:{ reason, commandId:sale.rows[0].command_id, commandNumber:sale.rows[0].command_number, commandName:sale.rows[0].command_name, saleChannel:sale.rows[0].sale_channel, table:sale.rows[0].display_label } }, client);
    });
  } catch (error) { fail("/relatorios", error instanceof Error ? error.message : "Não foi possível cancelar a venda."); }
  revalidatePath("/relatorios");
  revalidatePath("/manutencao-movimento");
  revalidatePath("/estoque");
  revalidatePath("/caixa");
  revalidatePath("/cozinha");
  revalidatePath("/venda-rapida");
  revalidatePath("/painel");
  revalidatePath("/clientes");
  revalidatePath("/pendencias");
  revalidatePath("/delivery");
  redirect("/relatorios");
}
