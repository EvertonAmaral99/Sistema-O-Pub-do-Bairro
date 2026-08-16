import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { canManageCommand } from "@/lib/roles";

export const dynamic="force-dynamic";

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Sessão encerrada."},{status:401});
  if(!canManageCommand(user.role)) return NextResponse.json({error:"Seu perfil não pode consultar créditos."},{status:403});
  const cpf=new URL(request.url).searchParams.get("cpf")?.replace(/\D/g,"")??"";
  if(cpf.length!==11) return NextResponse.json({error:"Informe um CPF com 11 números."},{status:400});
  const result=await query<{id:number;name:string;cpf:string;contact:string;store_credit_balance_cents:number}>("SELECT id,name,cpf,contact,store_credit_balance_cents FROM customers WHERE cpf=$1 AND active=TRUE",[cpf]);
  const customer=result.rows[0];
  if(!customer) return NextResponse.json({error:"Cliente não encontrado nesse CPF."},{status:404});
  return NextResponse.json({customer:{id:customer.id,name:customer.name,cpf:customer.cpf,contact:customer.contact,balanceCents:Number(customer.store_credit_balance_cents)}});
}
