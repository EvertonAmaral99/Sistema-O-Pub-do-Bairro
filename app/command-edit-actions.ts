"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { commandLabel } from "@/lib/command-label";

function numberValue(value:FormDataEntryValue|null){
  const parsed=Number(String(value??"").replace(",","."));
  return Number.isFinite(parsed)?parsed:0;
}

function positiveId(value:FormDataEntryValue|null){
  const id=Math.trunc(numberValue(value));
  if(id<1)throw new Error("Registro inválido.");
  return id;
}

function cleanText(value:FormDataEntryValue|null,maxLength:number){
  const text=String(value??"").trim().replace(/\s+/g," ");
  return text.slice(0,maxLength)||null;
}

function fail(path:string,message:string):never{
  redirect(`${path}?erro=${encodeURIComponent(message)}`);
}

function revalidateCommand(commandId:number){
  revalidatePath(`/comandas/${commandId}`);
  revalidatePath("/comandas");
  revalidatePath("/painel");
  revalidatePath("/cozinha");
}

type CommandRow={
  command_number:number|null;
  command_name:string|null;
  customer_name:string|null;
  notes:string|null;
  priority:boolean;
  display_label:string;
};

export async function updateCommandInfoAction(formData:FormData){
  const user=await requirePermission("COMMANDS");
  const commandId=positiveId(formData.get("commandId"));
  const commandNumberRaw=String(formData.get("commandNumber")??"").trim();
  const commandNumber=commandNumberRaw?Math.trunc(numberValue(formData.get("commandNumber"))):null;
  const commandName=cleanText(formData.get("commandName"),80);
  const customerName=cleanText(formData.get("customerName"),120);
  const notes=String(formData.get("notes")??"").trim().slice(0,1000)||null;

  if(commandNumber!==null&&(!Number.isSafeInteger(commandNumber)||commandNumber<1||commandNumber>2147483647)) fail(`/comandas/${commandId}`,"Informe um número de comanda válido.");
  if(commandNumber===null&&!commandName) fail(`/comandas/${commandId}`,"Informe o número ou o nome da comanda.");

  try{
    await transaction(async(client)=>{
      const current=await client.query<CommandRow>(`SELECT c.command_number,c.command_name,c.customer_name,c.notes,c.priority,cl.display_label
        FROM commands c JOIN command_locations cl ON cl.command_id=c.id
        WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c`,[commandId]);
      const command=current.rows[0];
      if(!command)throw new Error("A comanda não está aberta.");

      await client.query("UPDATE commands SET command_number=$1,command_name=$2,customer_name=$3,notes=$4 WHERE id=$5",[commandNumber,commandName,customerName,notes,commandId]);
      await auditLog({
        userId:user.id,
        action:"COMMAND_INFO_UPDATED",
        entityType:"COMMAND",
        entityId:commandId,
        description:`Editou as informações da comanda ${commandLabel(command)}, ${command.display_label}.`,
        metadata:{
          before:{commandNumber:command.command_number,commandName:command.command_name,customerName:command.customer_name,notes:command.notes},
          after:{commandNumber,commandName,customerName,notes},
        },
      },client);
    });
  }catch(error){
    const databaseError=error as {code?:string;constraint?:string};
    if(databaseError.code==="23505"){
      fail(`/comandas/${commandId}`,databaseError.constraint==="commands_open_name_idx"?"Já existe uma comanda aberta com esse nome.":"Esse número de comanda já está em uso.");
    }
    fail(`/comandas/${commandId}`,error instanceof Error?error.message:"Não foi possível editar a comanda.");
  }

  revalidateCommand(commandId);
  redirect(`/comandas/${commandId}`);
}

export async function toggleCommandPriorityAction(formData:FormData){
  const user=await requirePermission("COMMANDS");
  const commandId=positiveId(formData.get("commandId"));

  try{
    await transaction(async(client)=>{
      const current=await client.query<CommandRow>(`SELECT c.command_number,c.command_name,c.customer_name,c.notes,c.priority,cl.display_label
        FROM commands c JOIN command_locations cl ON cl.command_id=c.id
        WHERE c.id=$1 AND c.status='OPEN' FOR UPDATE OF c`,[commandId]);
      const command=current.rows[0];
      if(!command)throw new Error("A comanda não está aberta.");
      const nextPriority=!command.priority;

      await client.query("UPDATE commands SET priority=$1,priority_note=NULL,priority_updated_at=NOW(),priority_updated_by=$2 WHERE id=$3",[nextPriority,user.id,commandId]);
      await auditLog({
        userId:user.id,
        action:nextPriority?"COMMAND_PRIORITY_SET":"COMMAND_PRIORITY_REMOVED",
        entityType:"COMMAND",
        entityId:commandId,
        description:nextPriority?`Marcou a comanda ${commandLabel(command)}, ${command.display_label}, como prioridade.`:`Removeu a prioridade da comanda ${commandLabel(command)}, ${command.display_label}.`,
        metadata:{commandNumber:command.command_number,commandName:command.command_name,table:command.display_label,priority:nextPriority},
      },client);
    });
  }catch(error){
    fail(`/comandas/${commandId}`,error instanceof Error?error.message:"Não foi possível alterar a prioridade.");
  }

  revalidateCommand(commandId);
  redirect(`/comandas/${commandId}`);
}
