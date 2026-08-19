import Link from "next/link";
import { BadgeDollarSign, BriefcaseBusiness, UserRoundCheck, UserRoundPlus, UserRoundX } from "lucide-react";
import { createStaffMemberAction, toggleStaffMemberStatusAction } from "@/app/system-actions";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCpf, formatDateTime, formatMoney } from "@/lib/format";

type StaffMemberRow={
  id:number;
  name:string;
  cpf:string|null;
  contact:string|null;
  position:string|null;
  active:boolean;
  created_at:string;
  pending_count:string;
  pending_total:string;
};

export default async function StaffMembersPage({searchParams}:{searchParams:Promise<{erro?:string;sucesso?:string}>}){
  await requirePermission("STAFF");
  const params=await searchParams;
  const staffMembers=await query<StaffMemberRow>(`SELECT sm.id,sm.name,sm.cpf,sm.contact,sm.position,sm.active,sm.created_at,
    COUNT(p.id)::text AS pending_count,COALESCE(SUM(p.amount_cents),0)::text AS pending_total
    FROM staff_members sm
    LEFT JOIN payments p ON p.staff_member_id=sm.id AND p.method='STAFF_VOUCHER' AND p.staff_voucher_status='PENDING' AND p.voided_at IS NULL
    LEFT JOIN sales s ON s.id=p.sale_id AND s.status='COMPLETED'
    GROUP BY sm.id ORDER BY sm.active DESC,sm.name`);
  const totalPending=staffMembers.rows.reduce((sum,staff)=>sum+Number(staff.pending_total),0);
  return <>
    <div className="page-head"><div><p className="eyebrow">Equipe</p><h2>Cadastro de funcionários</h2><p>Funcionários ativos poderão ser vinculados aos vales gerados nas comandas.</p></div><div className="actions"><span className="badge badge-blue"><BriefcaseBusiness size={14}/> {staffMembers.rows.filter((staff)=>staff.active).length} ativo(s)</span><Link href="/pendencias" className="btn btn-light"><BadgeDollarSign size={16}/> Pendências: {formatMoney(totalPending)}</Link></div></div>
    {params.erro&&<div className="alert alert-error">{params.erro}</div>}
    {params.sucesso&&<div className="alert alert-success">{params.sucesso==="cadastro"?"Funcionário cadastrado.":params.sucesso==="ativado"?"Funcionário ativado.":"Funcionário inativado."}</div>}
    <section className="card" style={{marginBottom:22}}><h3><UserRoundPlus size={17}/> Novo funcionário</h3><form action={createStaffMemberAction} className="form-grid"><div className="field"><label>Nome completo</label><input className="input" name="name" required/></div><div className="field"><label>CPF — opcional</label><input className="input" name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00"/></div><div className="field"><label>Contato — opcional</label><input className="input" name="contact" placeholder="Telefone ou WhatsApp"/></div><div className="field"><label>Cargo — opcional</label><input className="input" name="position" placeholder="Ex.: Garçom"/></div><div className="form-submit-field"><button className="btn btn-primary" type="submit">Cadastrar funcionário</button></div></form></section>
    <section><h3>Funcionários cadastrados</h3>{staffMembers.rows.length===0?<div className="card empty">Nenhum funcionário cadastrado.</div>:<div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>CPF</th><th>Contato/Cargo</th><th>Vales pendentes</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{staffMembers.rows.map((staff)=><tr key={staff.id}><td><strong>{staff.name}</strong><br/><small>Cadastrado em {formatDateTime(staff.created_at)}</small></td><td>{staff.cpf?formatCpf(staff.cpf):"—"}</td><td>{staff.contact||"—"}{staff.position&&<><br/><small>{staff.position}</small></>}</td><td><strong>{staff.pending_count} vale(s)</strong><br/><span className="money">{formatMoney(staff.pending_total)}</span></td><td><span className={`badge ${staff.active?"badge-green":"badge-gray"}`}>{staff.active?"Ativo":"Inativo"}</span></td><td><form action={toggleStaffMemberStatusAction}><input type="hidden" name="staffMemberId" value={staff.id}/><input type="hidden" name="nextActive" value={String(!staff.active)}/><button className={`btn btn-small ${staff.active?"btn-danger":"btn-light"}`} type="submit">{staff.active?<><UserRoundX size={14}/> Inativar</>:<><UserRoundCheck size={14}/> Ativar</>}</button></form></td></tr>)}</tbody></table></div>}</section>
  </>;
}
