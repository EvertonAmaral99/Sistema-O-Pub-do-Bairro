import Link from "next/link";
import { KeyRound, ScrollText, ShieldCheck, UserCog, UserRoundCheck, UserRoundX } from "lucide-react";
import { changeOwnPasswordAction, createTableAction, createUserAction, toggleUserStatusAction, updateUserPermissionsAction } from "@/app/system-actions";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isManagementRole, permissionConfig, roleLabel, type Permission, type Role } from "@/lib/roles";

type ManagedUser = {
  id: number;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  permissions: Permission[];
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const actor = await requireUser();
  const management = isManagementRole(actor.role);
  const { erro, sucesso } = await searchParams;
  const users = management ? await query<ManagedUser>(`SELECT u.id,u.name,u.username,u.role,u.active,
    COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL),ARRAY[]::text[]) AS permissions
    FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
    GROUP BY u.id ORDER BY u.active DESC,u.name`) : { rows: [] as ManagedUser[] };
  const tables = management ? await query<{ id: number; number: number; label: string; active: boolean }>("SELECT id,number,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables ORDER BY number") : { rows: [] as { id:number;number:number;label:string;active:boolean }[] };

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
        <div><button className="btn btn-primary" type="submit">Alterar minha senha</button></div>
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
            return <tr key={managedUser.id}><td><strong>{managedUser.name}</strong></td><td>@{managedUser.username}</td><td><span className="badge badge-gray">{roleLabel[managedUser.role]}</span></td><td><span className={`badge ${managedUser.active ? "badge-green" : "badge-red"}`}>{managedUser.active ? "Ativo" : "Inativo"}</span></td><td>{canToggle ? <form action={toggleUserStatusAction}><input type="hidden" name="userId" value={managedUser.id}/><input type="hidden" name="nextActive" value={String(!managedUser.active)}/><button className={`btn btn-small ${managedUser.active ? "btn-danger" : "btn-light"}`} type="submit">{managedUser.active ? <><UserRoundX size={14}/> Inativar</> : <><UserRoundCheck size={14}/> Ativar</>}</button></form> : <small>{managedUser.id === actor.id ? "Sua conta" : "Ação restrita"}</small>}</td></tr>;
          })}</tbody></table></div>
        </section>

        <section className="card">
          <h3>Nova mesa</h3>
          <form action={createTableAction} className="form-stack">
            <div className="form-grid"><div className="field"><label>Número</label><input className="input" name="number" type="number" min="1" required/></div><div className="field"><label>Nome exibido</label><input className="input" name="label" placeholder="Ex.: Varanda 1"/></div></div>
            <button className="btn btn-primary" type="submit">Cadastrar mesa</button>
          </form>
          <div className="divider"/>
          <div className="table-wrap"><table><thead><tr><th>Número</th><th>Nome</th><th>Situação</th></tr></thead><tbody>{tables.rows.map((table) => <tr key={table.id}><td>{table.number}</td><td>{table.label}</td><td><span className={`badge ${table.active ? "badge-green" : "badge-gray"}`}>{table.active ? "Ativa" : "Inativa"}</span></td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="card permissions-section">
        <div className="page-head permissions-head"><div><p className="eyebrow">Controle por funcionário</p><h3><UserCog size={19}/> Acessos aos módulos</h3><p>Marque somente as áreas que cada pessoa poderá abrir e utilizar.</p></div><span className="badge badge-blue"><ShieldCheck size={13}/> Gestão de acessos: Gerente e Administrador</span></div>
        <div className="permission-list">
          {users.rows.map((managedUser) => {
            const hierarchyLocked = managedUser.role === "ADMIN" || (actor.role === "MANAGER" && managedUser.role === "MANAGER");
            return <article className={`permission-user-card ${!managedUser.active ? "permission-user-inactive" : ""}`} key={managedUser.id}>
              <div className="permission-user-info"><div><strong>{managedUser.name}</strong><small>@{managedUser.username}</small></div><div className="actions"><span className={`badge ${managedUser.active ? "badge-green" : "badge-red"}`}>{managedUser.active ? "Ativo" : "Inativo"}</span><span className="badge badge-gray">{roleLabel[managedUser.role]}</span></div></div>
              {!managedUser.active ? <div className="permission-lock"><UserRoundX size={17}/><span>Ative o funcionário antes de alterar os acessos.</span></div> : managedUser.role === "ADMIN" ? <div className="permission-lock"><ShieldCheck size={17}/><span>Administradores possuem acesso completo.</span></div> : hierarchyLocked ? <div className="permission-lock"><ShieldCheck size={17}/><span>Somente um Administrador pode alterar os acessos de outro Gerente.</span></div> :
                <form action={updateUserPermissionsAction} className="permission-form">
                  <input type="hidden" name="userId" value={managedUser.id}/>
                  <div className="permission-grid">{permissionConfig.map((permission) => {
                    const managementOnly = "managementOnly" in permission && permission.managementOnly;
                    if (managementOnly && !isManagementRole(managedUser.role)) return <div className="permission-option permission-protected" key={permission.key}><ShieldCheck size={16}/><span><strong>{permission.label}</strong><small>Somente Gerente e Administrador.</small></span></div>;
                    return <label className="permission-option" key={permission.key}><input type="checkbox" name="permissions" value={permission.key} defaultChecked={managedUser.permissions.includes(permission.key)}/><span><strong>{permission.label}</strong><small>{permission.description}</small></span></label>;
                  })}</div>
                  <div className="permission-actions"><button className="btn btn-primary btn-small" type="submit">Salvar acessos</button></div>
                </form>}
            </article>;
          })}
        </div>
      </section>
    </>}
  </>;
}
