import Link from "next/link";
import { EventForm } from "@/components/event-form";
import { requireRole } from "@/lib/auth";

export default async function NewEventPage({searchParams}:{searchParams:Promise<{data?:string;erro?:string}>}){
  await requireRole(["ADMIN","MANAGER"]);
  const params=await searchParams;
  const date=/^\d{4}-\d{2}-\d{2}$/.test(params.data??"")?params.data:undefined;
  return <><div className="page-head"><div><p className="eyebrow">Agenda</p><h2>Cadastrar evento</h2><p>Informe a programação, duração e valor combinado.</p></div><Link href="/agenda" className="btn btn-light">Voltar ao calendário</Link></div>{params.erro&&<div className="alert alert-error">{params.erro}</div>}<EventForm defaultDate={date}/></>;
}
