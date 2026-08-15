import { CalendarPlus, Save } from "lucide-react";
import { createEventAction, updateEventAction } from "@/app/system-actions";

type EventData = { id:number;name:string;event_date:string;start_time:string;duration_hours:number|string;amount_cents:number };

export function EventForm({event,defaultDate}:{event?:EventData;defaultDate?:string}) {
  const action=event?updateEventAction:createEventAction;
  return <form action={action} className="card form-stack event-form">
    {event&&<input type="hidden" name="eventId" value={event.id}/>} 
    <div className="field"><label>Nome do evento</label><input className="input" name="name" defaultValue={event?.name} placeholder="Ex.: Pagode ao vivo" required/></div>
    <div className="form-grid"><div className="field"><label>Data do evento</label><input className="input" name="eventDate" type="date" defaultValue={event?.event_date??defaultDate} required/></div><div className="field"><label>Horário de início</label><input className="input" name="startTime" type="time" defaultValue={event?.start_time?.slice(0,5)} required/></div></div>
    <div className="form-grid"><div className="field"><label>Duração em horas</label><input className="input" name="durationHours" type="number" min="0.5" step="0.5" defaultValue={event?.duration_hours??"1"} required/></div><div className="field"><label>Valor a pagar pelo evento (R$)</label><input className="input" name="amount" type="number" min="0" step="0.01" defaultValue={event?(event.amount_cents/100).toFixed(2):"0.00"} required/></div></div>
    <button className="btn btn-primary" type="submit">{event?<Save size={16}/>:<CalendarPlus size={16}/>} {event?"Salvar alterações":"Cadastrar evento"}</button>
  </form>;
}
