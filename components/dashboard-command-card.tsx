"use client";

import Link from "next/link";
import { useRef } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { updateCommandPriorityAction } from "@/app/system-actions";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PriorityInfo } from "@/components/priority-info";
import { CommandCardIdentifier } from "@/components/command-card-identifier";
import { commandLabel } from "@/lib/command-label";

type Command = {
  id:number;
  command_number:number|null;
  command_name:string|null;
  table_display:string;
  customer_name:string|null;
  opened_at:string;
  total:string;
  priority:boolean;
  priority_note:string|null;
};

export function DashboardCommandCard({ command, canViewFinance }: { command:Command; canViewFinance:boolean }) {
  const dialogRef=useRef<HTMLDialogElement>(null);
  const identifier=commandLabel(command);

  return <article className={`command-card dashboard-command-card ${command.priority?"priority-alert":""}`}>
    <button className={`dashboard-priority-shortcut ${command.priority?"active":""}`} type="button" onClick={()=>dialogRef.current?.showModal()} title={command.priority?"Alterar prioridade":"Marcar como prioridade"} aria-label={command.priority?`Alterar prioridade da comanda ${identifier}`:`Marcar comanda ${identifier} como prioridade`}><AlertTriangle size={17}/></button>
    <Link className="dashboard-command-link" href={`/comandas/${command.id}`}>
      <div className="command-top"><CommandCardIdentifier commandNumber={command.command_number} commandName={command.command_name}/><span className="badge badge-amber">{command.table_display}</span></div>
      {command.priority&&<div className="priority-label">Prioridade <PriorityInfo note={command.priority_note}/></div>}
      <p>{command.customer_name||"Cliente não informado"}<br/>{formatDateTime(command.opened_at)}</p>{canViewFinance&&<strong className="money">{formatMoney(command.total)}</strong>}
    </Link>
    <dialog className="priority-dialog" ref={dialogRef}>
      <div className="priority-dialog-head"><div><span className="eyebrow">Atalho de prioridade</span><h3>Comanda {identifier}</h3><p>{command.table_display}</p></div><form method="dialog"><button className="priority-dialog-close" type="submit" aria-label="Fechar"><X size={19}/></button></form></div>
      <form action={updateCommandPriorityAction} className="form-stack">
        <input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="true"/><input type="hidden" name="returnTo" value="/painel"/>
        <div className="field"><label>Observação ou motivo da prioridade</label><textarea className="textarea" name="priorityNote" minLength={3} defaultValue={command.priority_note??""} rows={4} placeholder="Digite o que aconteceu com esta comanda" required/></div>
        <button className="btn btn-primary" type="submit">Salvar prioridade</button>
      </form>
      <form action={updateCommandPriorityAction} className="priority-dialog-remove"><input type="hidden" name="commandId" value={command.id}/><input type="hidden" name="priority" value="false"/><input type="hidden" name="returnTo" value="/painel"/><button className="btn btn-danger" type="submit"><Trash2 size={16}/> Excluir observação e desativar prioridade</button></form>
    </dialog>
  </article>;
}
