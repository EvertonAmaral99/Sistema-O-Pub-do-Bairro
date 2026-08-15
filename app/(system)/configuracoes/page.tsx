import Link from "next/link";
import { ScrollText, ShieldCheck, UserCog } from "lucide-react";
import { createTableAction, createUserAction, updateUserPermissionsAction } from "@/app/system-actions";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { permissionConfig, roleLabel, type Permission, type Role } from "@/lib/roles";

type ManagedUser = {
  id: number;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  permissions: Permission[];
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const actor = await requireRole(["ADMIN", "MANAGER"]);
  const { erro } = await searchParams;
  const [users, tables] = await Promise.all([
    query<ManagedUser>(`SELECT u.id,u.name,u.username,u.role,u.active,
      COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL),ARRAY[]::text[]) AS permissions
      FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
      GROUP BY u.id ORDER BY u.name`),
    query<{ id: number; number: number; label: string; active: boolean }>("SELECT id,number,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables ORDER BY number"),
  ]);

  return <>
    <div className="page-head"><div><p className="eyebrow">Administração</p><h2>Configurações</h2><p>Cadastre funcionários, defina acessos e organize as mesas.</p></div><Link href="/logs" className="btn btn-light"><ScrollText size={16}/> Abrir histórico</Link></div>
    {erro && <div className="alert alert-error">{erro}</div>}

    <div className="grid grid-2 settings-grid">
      <section className="card">
        <h3>Novo funcionário</h3>
        <form action={createUserAction} className="form-stack">
          <div className="form-grid">
            <div className="field"><label>Nome</label><input className="input" name="name" required/></div>
            <div className="field"><label>Usuário</label><input className="input" name="username" minLength={3} required/></div>
            <div className="field"><label>Senha inicial</label><input className="input" name="password" type="password" minLength={8} required/></div>
            <div className="field"><label>Perfil</label><select className="select" name="role">
              <option value="CASHIER">Caixa</option><option value="KITCHEN">Cozinha</option>
              {actor.role === "ADMIN" && <><option value="MANAGER">Gerente</option><option value="ADMIN">Administrador</option></>}
            </select></div>
          </div>
          <button className="btn btn-primary" type="submit">Cadastrar funcionário</button>
        </form>
        <div className="divider"/>
        <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th></tr></thead><tbody>{users.rows.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.username}</td><td><span className="badge badge-gray">{roleLabel[user.role]}</span></td></tr>)}</tbody></table></div>
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
      <div className="page-head permissions-head"><div><p className="eyebrow">Controle por funcionário</p><h3><UserCog size={19}/> Acessos aos módulos</h3><p>Marque somente as áreas que cada pessoa poderá abrir e utilizar.</p></div><span className="badge badge-blue"><ShieldCheck size={13}/> Configurações e histórico: Gerente e Administrador</span></div>
      <div className="permission-list">
        {users.rows.map((managedUser) => {
          const locked = managedUser.role === "ADMIN" || (actor.role === "MANAGER" && managedUser.role === "MANAGER");
          return <article className="permission-user-card" key={managedUser.id}>
            <div className="permission-user-info"><div><strong>{managedUser.name}</strong><small>@{managedUser.username}</small></div><span className="badge badge-gray">{roleLabel[managedUser.role]}</span></div>
            {managedUser.role === "ADMIN" ? <div className="permission-lock"><ShieldCheck size={17}/><span>Administradores possuem acesso completo.</span></div> : locked ? <div className="permission-lock"><ShieldCheck size={17}/><span>Somente um Administrador pode alterar os acessos de outro Gerente.</span></div> :
              <form action={updateUserPermissionsAction} className="permission-form">
                <input type="hidden" name="userId" value={managedUser.id}/>
                <div className="permission-grid">{permissionConfig.map((permission) => <label className="permission-option" key={permission.key}>
                  <input type="checkbox" name="permissions" value={permission.key} defaultChecked={managedUser.permissions.includes(permission.key)}/>
                  <span><strong>{permission.label}</strong><small>{permission.description}</small></span>
                </label>)}</div>
                <div className="permission-actions"><button className="btn btn-primary btn-small" type="submit">Salvar acessos</button></div>
              </form>}
          </article>;
        })}
      </div>
    </section>
  </>;
}
