import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { notFound } from "next/navigation";
import { updateTableAction } from "@/app/system-actions";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

type TableRow = {
  id:number;
  number:number;
  label:string;
  active:boolean;
  open_commands:string;
};

export default async function EditTablePage({ params, searchParams }: { params:Promise<{id:string}>;searchParams:Promise<{erro?:string}> }) {
  await requireRole(["ADMIN","MANAGER"]);
  const tableId = Number((await params).id);
  const { erro } = await searchParams;
  if (!Number.isInteger(tableId) || tableId < 1) notFound();
  const result = await query<TableRow>(`SELECT bt.id,bt.number,COALESCE(bt.label,'Mesa '||bt.number) AS label,bt.active,
    (SELECT COUNT(*) FROM command_tables ct JOIN commands c ON c.id=ct.command_id WHERE ct.table_id=bt.id AND c.status='OPEN')::text AS open_commands
    FROM bar_tables bt WHERE bt.id=$1`, [tableId]);
  const table = result.rows[0];
  if (!table) notFound();

  return <>
    <div className="page-head"><div><p className="eyebrow">Organização do salão</p><h2>Editar {table.label}</h2><p>Somente Gerentes e Administradores podem alterar mesas.</p></div><Link href="/configuracoes" className="btn btn-light"><ArrowLeft size={16}/> Voltar</Link></div>
    {erro && <div className="alert alert-error">{erro}</div>}
    <section className="card table-edit-card">
      <form action={updateTableAction} className="form-stack">
        <input type="hidden" name="tableId" value={table.id}/>
        <div className="form-grid"><div className="field"><label>Número da mesa</label><input className="input" name="number" type="number" min="1" defaultValue={table.number} required/></div><div className="field"><label>Nome exibido</label><input className="input" name="label" maxLength={80} defaultValue={table.label} required/></div></div>
        <label className="check-row"><input type="checkbox" name="active" defaultChecked={table.active}/> Mesa ativa para novas comandas</label>
        {Number(table.open_commands) > 0 && <small>Esta mesa possui {table.open_commands} comanda(s) aberta(s) e não poderá ser inativada até o encerramento.</small>}
        <div className="actions"><button className="btn btn-primary" type="submit"><Save size={16}/> Salvar alterações</button><Link href="/configuracoes" className="btn btn-light">Cancelar</Link></div>
      </form>
    </section>
  </>;
}
