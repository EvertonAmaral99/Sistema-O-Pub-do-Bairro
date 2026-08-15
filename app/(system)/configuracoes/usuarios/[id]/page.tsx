import Link from "next/link";
import { ArrowLeft, Save, ShieldCheck, UserRoundX } from "lucide-react";
import { notFound } from "next/navigation";
import { updateUserPermissionsAction } from "@/app/system-actions";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { isManagementRole, permissionConfig, roleLabel, type Permission, type Role } from "@/lib/roles";

type ManagedUser = {
  id:number;
  name:string;
  username:string;
  role:Role;
  active:boolean;
  permissions:Permission[];
};

export default async function EditUserPermissionsPage({ params,searchParams }:{ params:Promise<{id:string}>;searchParams:Promise<{erro?:string;sucesso?:string}> }) {
  const actor=await requireRole(["ADMIN","MANAGER"]);
  const userId=Number((await params).id);
  const {erro,sucesso}=await searchParams;
  if(!Number.isInteger(userId)||userId<1) notFound();
  const result=await query<ManagedUser>(`SELECT u.id,u.name,u.username,u.role,u.active,
    COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL),ARRAY[]::text[]) AS permissions
    FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
    WHERE u.id=$1 GROUP BY u.id`,[userId]);
  const managedUser=result.rows[0];
  if(!managedUser) notFound();
  const hierarchyLocked=actor.role==="MANAGER"&&isManagementRole(managedUser.role);

  return <>
    <div className="page-head"><div><p className="eyebrow">Permissões do funcionário</p><h2>Editar {managedUser.name}</h2><p>Ative ou desative as áreas que este usuário poderá abrir e utilizar.</p></div><Link href="/configuracoes" className="btn btn-light"><ArrowLeft size={16}/> Voltar</Link></div>
    {erro&&<div className="alert alert-error">{erro}</div>}
    {sucesso==="permissoes"&&<div className="alert alert-info">As permissões foram atualizadas.</div>}
    <section className={`card user-permission-edit-card ${!managedUser.active?"permission-user-inactive":""}`}>
      <div className="permission-user-info"><div><strong>{managedUser.name}</strong><small>@{managedUser.username}</small></div><div className="actions"><span className={`badge ${managedUser.active?"badge-green":"badge-red"}`}>{managedUser.active?"Ativo":"Inativo"}</span><span className="badge badge-gray">{roleLabel[managedUser.role]}</span></div></div>
      {!managedUser.active?<div className="permission-lock"><UserRoundX size={17}/><span>Ative este funcionário na tela anterior antes de alterar os acessos.</span></div>:managedUser.role==="ADMIN"?<><div className="permission-lock"><ShieldCheck size={17}/><span>Administradores possuem acesso completo.</span></div><div className="permission-grid permission-grid-readonly">{permissionConfig.map((permission)=><div className="permission-option permission-protected" key={permission.key}><ShieldCheck size={16}/><span><strong>{permission.label}</strong><small>Acesso ativo para Administrador.</small></span></div>)}</div></>:hierarchyLocked?<div className="permission-lock"><ShieldCheck size={17}/><span>Somente um Administrador pode alterar os acessos de outro Gerente.</span></div>:<form action={updateUserPermissionsAction} className="permission-form">
        <input type="hidden" name="userId" value={managedUser.id}/><input type="hidden" name="returnTo" value={`/configuracoes/usuarios/${managedUser.id}`}/>
        <div className="permission-grid">{permissionConfig.map((permission)=>{
          const managementOnly="managementOnly" in permission&&permission.managementOnly;
          if(managementOnly&&!isManagementRole(managedUser.role)) return <div className="permission-option permission-protected" key={permission.key}><ShieldCheck size={16}/><span><strong>{permission.label}</strong><small>Disponível somente para os perfis Gerente e Administrador.</small></span></div>;
          return <label className="permission-option" key={permission.key}><input type="checkbox" name="permissions" value={permission.key} defaultChecked={managedUser.permissions.includes(permission.key)}/><span><strong>{permission.label}</strong><small>{permission.description}</small></span></label>;
        })}</div>
        <div className="permission-actions"><Link href="/configuracoes" className="btn btn-light">Cancelar</Link><button className="btn btn-primary" type="submit"><Save size={16}/> Salvar permissões</button></div>
      </form>}
    </section>
  </>;
}
