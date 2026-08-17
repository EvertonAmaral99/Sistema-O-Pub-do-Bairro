import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isManagementRole } from "@/lib/roles";

export const dynamic="force-dynamic";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Sessão encerrada."},{status:401});
  if(!isManagementRole(user.role)) return NextResponse.json({error:"Seu perfil não pode abrir relatórios de vendas."},{status:403});
  const saleId=Number((await params).id);
  if(!Number.isInteger(saleId)||saleId<1) return NextResponse.json({error:"Venda inválida."},{status:400});
  const sale=await query<{id:number;command_id:number;command_number:number|null;command_name:string|null;sale_channel:string;table_display:string;customer_id:number|null;customer_name:string|null;customer_cpf:string|null;subtotal_cents:number;discount_cents:number;service_fee_cents:number;total_cents:number;split_count:number;status:string;created_at:string;user_name:string}>(`SELECT s.id,s.command_id,c.command_number,c.command_name,c.sale_channel,cl.display_label AS table_display,s.customer_id,COALESCE(customer.name,c.customer_name) AS customer_name,customer.cpf AS customer_cpf,s.subtotal_cents,s.discount_cents,s.service_fee_cents,s.total_cents,s.split_count,s.status,s.created_at,u.name AS user_name FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id JOIN users u ON u.id=s.created_by LEFT JOIN customers customer ON customer.id=s.customer_id WHERE s.id=$1`,[saleId]);
  if(!sale.rows[0]) return NextResponse.json({error:"Venda não encontrada."},{status:404});
  const [items,payments]=await Promise.all([
    query<{id:number;product_name:string;quantity:string;unit_price_cents:number;display_unit:string}>("SELECT id,product_name,quantity::text,unit_price_cents,display_unit FROM order_items WHERE command_id=$1 AND status<>'CANCELLED' ORDER BY id",[sale.rows[0].command_id]),
    query<{id:number;method:string;amount_cents:number;staff_member_id:number|null;staff_member_name:string|null;staff_voucher_status:string|null;customer_id:number|null;customer_name:string|null}>("SELECT p.id,p.method,p.amount_cents,p.staff_member_id,COALESCE(sm.name,p.staff_member_name) AS staff_member_name,p.staff_voucher_status,p.customer_id,c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN staff_members sm ON sm.id=p.staff_member_id WHERE p.sale_id=$1 AND p.voided_at IS NULL ORDER BY p.id",[saleId]),
  ]);
  return NextResponse.json({sale:sale.rows[0],items:items.rows,payments:payments.rows});
}
