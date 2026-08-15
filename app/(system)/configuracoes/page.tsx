import Link from "next/link";
import { KeyRound, Pencil, ScrollText, UserCog, UserRoundCheck, UserRoundX } from "lucide-react";
import { changeOwnPasswordAction, createTableAction, createUserAction, toggleUserStatusAction } from "@/app/system-actions";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isManagementRole, roleLabel, type Role } from "@/lib/roles";

type ManagedUser = {
  id: number;
  name: string;
  username: string;
  role: Role;
  active: boolean;
};

type ManagedTable = { id:number;number:number;label:string;active:boolean };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const actor = await requireUser();
  const management = isManagementRole(actor.role);
  const { erro, sucesso } = await searchParams;
  const users = management ? await query<ManagedUser>(`SELECT id,name,username,role,active FROM users ORDER BY active DESC,name`) : { rows: [] as ManagedUser[] };
  const tables = management ? await query<ManagedTable>(`SELECT id,number,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables ORDER BY number`) : { rows: [] as ManagedTable[] };

  return <>
    <div className="page-head"><div><p className="eyebrow">Conta e administração</p><h2>Configurações</h2><p>Altere sua senha{management ? ", cadastre funcionários e organize os acessos." : "."}</p></div>{management && <Link href="/logs" className="btn btn-light"><ScrollText size={16}/> Abrir histórico</Link>}</div>
    {erro && <div className="alert alert-error">{erro}</div>}
    {sucesso === "senha" && <div className="alert alert-info">Sua senha foi alterada.</div>}

    <section className="card password-card">
      <div className="password-card-title"><KeyRound size={20}/><div><h3>Minha senha</h3><p>Cada funcionário pode alterar somente a própria senha.</p></div></div>
      <form action={changeOwnPasswordAction} className="form-grid">
        <div className="field"><label>Senha atual</label><input className="input" name="currentPassword" type="password" autoComplete="current-password" required/></div>
        <div className="field"><label>Nova senha</label><input className="input" name="newPassword" type="password" minLength={8} autoComplete="new-password" required/><small>Mínimo de 8 caracteres.</small></div>
        <div className="field"><label>Confirmar nova senha</label><input className="input" name="confirmation" type="password" minLength={8} autoComplete="new-password" required/></div>
        <div className="form-submit-field"><button className="btn btn-primary" type="submit">Alterar minha senha</button></div>
      </form>
    </section>

    {management && <>
      <div className="grid grid-2 settings-grid management-settings">
        <section className="card">
          <h3>Novo funcionário</h3>
          <form action={createUserAction} className="form-stack">
            <div className="form-grid">
              <div className="field"><label>Nome</label><input className="input" name="name" required/></div>
              <div className="field"><label>Usuário</label><input className="input" name="username" minLength={3} required/></div>
              <div className="field"><label>Senha inicial</label><input className="input" name="password" type="password" minLength={8} required/></div>
              <div className="field"><label>Perfil</label><select className="select" name="role">
                <option value="ATTENDANT">Atendente</option><option value="CASHIER">Caixa</option><option value="WAITER">Garçom</option><option value="KITCHEN">Cozinha</option>
                {actor.role === "ADMIN" && <><option value="MANAGER">Gerente</option><option value="ADMIN">Administrador</option></>}
              </select></div>
            </div>
            <button className="btn btn-primary" type="submit">Cadastrar funcionário</button>
          </form>
          <div className="divider"/>
          <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{users.rows.map((managedUser) => {
            const canToggle = managedUser.id !== actor.id && !(actor.role === "MANAGER" && isManagementRole(managedUser.role));
            return <tr key={managedUser.id}><td><div className="user-name-edit"><strong>{managedUser.name}</strong><Link href={`/configuracoes/usuarios/${managedUser.id}`} className="btn btn-light btn-small"><UserCog size={14}/> Editar</Link></div></td><td>@{managedUser.username}</td><td><span className="badge badge-gray">{roleLabel[managedUser.role]}</span></td><td><span className={`badge ${managedUser.active ? "badge-green" : "badge-red"}`}>{managedUser.active ? "Ativo" : "Inativo"}</span></td><td>{canToggle ? <form action={toggleUserStatusAction}><input type="hidden" name="userId" value={managedUser.id}/><input type="hidden" name="nextActive" value={String(!managedUser.active)}/><button className={`btn btn-small ${managedUser.active ? "btn-danger" : "btn-light"}`} type="submit">{managedUser.active ? <><UserRoundX size={14}/> Inativar</> : <><UserRoundCheck size={14}/> Ativar</>}</button></form> : <small>{managedUser.id === actor.id ? "Sua conta" : "Ação restrita"}</small>}</td></tr>;
          })}</tbody></table></div>
        </section>

        <section className="card">
          <h3>Nova mesa</h3>
          <form action={createTableAction} className="form-stack">
            <div className="form-grid"><div className="field"><label>Número</label><input className="input" name="number" type="number" min="1" required/></div><div className="field"><label>Nome exibido</label><input className="input" name="label" placeholder="Ex.: Varanda 1"/></div></div>
            <button className="btn btn-primary" type="submit">Cadastrar mesa</button>
          </form>
          <div className="divider"/>
          <div className="table-wrap"><table><thead><tr><th>Número</th><th>Nome</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{tables.rows.map((table) => <tr key={table.id}><td>{table.number}</td><td>{table.label}</td><td><span className={`badge ${table.active ? "badge-green" : "badge-gray"}`}>{table.active ? "Ativa" : "Inativa"}</span></td><td><Link href={`/configuracoes/mesas/${table.id}`} className="btn btn-light btn-small"><Pencil size={14}/> Editar</Link></td></tr>)}</tbody></table></div>
        </section>
      </div>

    </>}
  </>;
}
