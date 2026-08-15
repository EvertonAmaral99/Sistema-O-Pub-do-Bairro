import Link from "next/link";
import { KeyRound, Link2, Pencil, ScrollText, ShieldCheck, Unlink, UserCog, UserRoundCheck, UserRoundX } from "lucide-react";
import { changeOwnPasswordAction, combineTablesAction, createTableAction, createUserAction, toggleUserStatusAction, uncombineTablesAction, updateUserPermissionsAction } from "@/app/system-actions";
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

type ManagedTable = { id:number;number:number;label:string;active:boolean;display_label:string;combination_id:number|null };
type TableCombination = { id:number;display_label:string;table_count:string };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const actor = await requireUser();
  const management = isManagementRole(actor.role);
  const { erro, sucesso } = await searchParams;
  const users = management ? await query<ManagedUser>(`SELECT u.id,u.name,u.username,u.role,u.active,
    COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL),ARRAY[]::text[]) AS permissions
    FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
    GROUP BY u.id ORDER BY u.active DESC,u.name`) : { rows: [] as ManagedUser[] };
  const tables = management ? await query<ManagedTable>(`SELECT bt.id,bt.number,COALESCE(bt.label,'Mesa '||bt.number) AS label,bt.active,tl.display_label,tl.combination_id
    FROM bar_tables bt JOIN table_locations tl ON tl.table_id=bt.id ORDER BY bt.number`) : { rows: [] as ManagedTable[] };
  const combinations = management ? await query<TableCombination>(`SELECT tc.id,
    string_agg(COALESCE(bt.label,'Mesa '||bt.number), ' + ' ORDER BY bt.number) AS display_label,
    COUNT(*)::text AS table_count
    FROM table_combinations tc JOIN table_combination_members tcm ON tcm.combination_id=tc.id JOIN bar_tables bt ON bt.id=tcm.table_id
    GROUP BY tc.id ORDER BY MIN(bt.number)`) : { rows: [] as TableCombination[] };
  const availableTables = tables.rows.filter((table) => table.active && !table.combination_id);

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
          <div className="table-wrap"><table><thead><tr><th>Número</th><th>Nome</th><th>Combinação</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{tables.rows.map((table) => <tr key={table.id}><td>{table.number}</td><td>{table.label}</td><td>{table.combination_id ? <span className="badge badge-blue">{table.display_label}</span> : <small>Individual</small>}</td><td><span className={`badge ${table.active ? "badge-green" : "badge-gray"}`}>{table.active ? "Ativa" : "Inativa"}</span></td><td><Link href={`/configuracoes/mesas/${table.id}`} className="btn btn-light btn-small"><Pencil size={14}/> Editar</Link></td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="card table-combinations-card">
        <div className="page-head permissions-head"><div><p className="eyebrow">Organização do salão</p><h3><Link2 size={19}/> Combinar mesas</h3><p>Selecione duas ou mais mesas. Elas aparecerão juntas nas comandas, mantendo comandas separadas por pessoa.</p></div></div>
        {availableTables.length >= 2 ? <form action={combineTablesAction} className="form-stack">
          <div className="table-choice-grid">{availableTables.map((table) => <label className="table-choice" key={table.id}><input type="checkbox" name="tableIds" value={table.id}/><span><strong>{table.label}</strong><small>Mesa {table.number}</small></span></label>)}</div>
          <div><button className="btn btn-primary" type="submit"><Link2 size={16}/> Combinar mesas selecionadas</button></div>
        </form> : <div className="alert alert-info">É necessário ter ao menos duas mesas ativas e sem combinação.</div>}
        {combinations.rows.length > 0 && <><div className="divider"/><h3>Combinações atuais</h3><div className="combination-list">{combinations.rows.map((combination) => <div className="combination-row" key={combination.id}><div><strong>{combination.display_label}</strong><small>{combination.table_count} mesas combinadas</small></div><form action={uncombineTablesAction}><input type="hidden" name="combinationId" value={combination.id}/><button className="btn btn-danger btn-small" type="submit"><Unlink size={14}/> Desfazer combinação</button></form></div>)}</div></>}
      </section>

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
