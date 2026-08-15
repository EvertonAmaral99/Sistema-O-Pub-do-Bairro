import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatMoney } from "@/lib/format";

type CalendarEvent={id:number;name:string;event_date:string;start_time:string;duration_hours:number|string;amount_cents:number};
const weekDays=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function monthShift(year:number,month:number,offset:number){const date=new Date(Date.UTC(year,month-1+offset,1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}

export default async function AgendaPage({searchParams}:{searchParams:Promise<{mes?:string}>}){
  await requireRole(["ADMIN","MANAGER"]);
  const params=await searchParams;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"}).format(new Date());
  const monthValue=/^\d{4}-(0[1-9]|1[0-2])$/.test(params.mes??"")?params.mes!:today.slice(0,7);
  const [year,month]=monthValue.split("-").map(Number);
  const firstWeekDay=new Date(Date.UTC(year,month-1,1)).getUTCDay();
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  const events=await query<CalendarEvent>(`SELECT id,name,event_date::text,start_time::text,duration_hours,amount_cents FROM events WHERE event_date >= $1::date AND event_date < ($1::date + INTERVAL '1 month') ORDER BY event_date,start_time`,[`${monthValue}-01`]);
  const byDate=new Map<string,CalendarEvent[]>(); for(const event of events.rows) byDate.set(event.event_date,[...(byDate.get(event.event_date)??[]),event]);
  const title=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));
  const cells=Array.from({length:firstWeekDay+daysInMonth},(_,index)=>index<firstWeekDay?null:index-firstWeekDay+1);

  return <><div className="page-head"><div><p className="eyebrow">Programação da casa</p><h2>Agenda de eventos</h2><p>Cadastre e altere os eventos previstos para cada dia.</p></div><Link href={`/agenda/novo?data=${monthValue}-01`} className="btn btn-primary"><CalendarPlus size={16}/> Cadastrar evento</Link></div>
    <section className="card calendar-card"><div className="calendar-toolbar"><Link className="btn btn-light btn-small" href={`/agenda?mes=${monthShift(year,month,-1)}`} aria-label="Mês anterior"><ChevronLeft size={17}/></Link><h3>{title}</h3><Link className="btn btn-light btn-small" href={`/agenda?mes=${monthShift(year,month,1)}`} aria-label="Próximo mês"><ChevronRight size={17}/></Link></div>
      <div className="calendar-grid">{weekDays.map((day)=><div className="calendar-weekday" key={day}>{day}</div>)}{cells.map((day,index)=>day===null?<div className="calendar-day calendar-empty" key={`empty-${index}`}/>:(()=>{const date=`${monthValue}-${String(day).padStart(2,"0")}`;const dayEvents=byDate.get(date)??[];return <div className={`calendar-day ${date===today?"calendar-today":""}`} key={date}><Link className="calendar-day-number" href={`/agenda/novo?data=${date}`}>{day}</Link><div className="calendar-events">{dayEvents.map((event)=><Link className="calendar-event" href={`/agenda/${event.id}`} key={event.id}><strong>{event.name}</strong><span><Clock size={11}/> {event.start_time.slice(0,5)} · {Number(event.duration_hours).toLocaleString("pt-BR",{maximumFractionDigits:2})}h</span><small>{formatMoney(event.amount_cents)}</small></Link>)}</div></div>})())}</div>
    </section>
  </>;
}
