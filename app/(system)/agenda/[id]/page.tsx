import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteEventAction } from "@/app/system-actions";
import { EventForm } from "@/components/event-form";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";

export default async function EditEventPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{erro?:string}>}){
  await requirePermission("AGENDA");
  const eventId=Number((await params).id); const queryParams=await searchParams;
  const result=await query<{id:number;name:string;event_date:string;start_time:string;duration_hours:number|string;amount_cents:number}>("SELECT id,name,event_date::text,start_time::text,duration_hours,amount_cents FROM events WHERE id=$1",[eventId]);
  const event=result.rows[0]; if(!event)notFound();
  return <><div className="page-head"><div><p className="eyebrow">Agenda</p><h2>Alterar evento</h2><p>Atualize os dados ou exclua este evento do calendário.</p></div><Link href={`/agenda?mes=${event.event_date.slice(0,7)}`} className="btn btn-light">Voltar ao calendário</Link></div>{queryParams.erro&&<div className="alert alert-error">{queryParams.erro}</div>}<EventForm event={event}/><form action={deleteEventAction} className="event-delete-form"><input type="hidden" name="eventId" value={event.id}/><button className="btn btn-danger" type="submit"><Trash2 size={16}/> Excluir evento</button></form></>;
}
