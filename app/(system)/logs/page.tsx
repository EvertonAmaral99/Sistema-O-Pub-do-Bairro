import Link from "next/link";
import { Filter, ScrollText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

type AuditRow = { id:number;action:string;entity_type:string;entity_id:string|null;description:string;created_at:string;user_name:string;username:string|null };

const entityLabel: Record<string, string> = {
  CASH:"Caixa",COMMAND:"Comanda",KITCHEN_TICKET:"Produção",ORDER_ITEM:"Item",SALE:"Venda",QUICK_SALE_PENDING:"Pendência de venda",DELIVERY:"Delivery",PRODUCT:"Produto",STOCK_POOL:"Estoque",TABLE:"Mesa",TABLE_COMBINATION:"Combinação de mesas",USER:"Usuário",STAFF_MEMBER:"Funcionário",CUSTOMER:"Cliente",PAYMENT:"Pagamento",SESSION:"Acesso",SYSTEM:"Sistema",EVENT:"Evento",
};

const movementConfig = [
  ["LOGIN","Entrada no sistema"],["LOGOUT","Saída do sistema"],["COMMAND_OPENED","Abrir comanda"],["COMMAND_CANCELLED","Cancelar comanda"],
  ["COMMAND_PRIORITY_SET","Adicionar prioridade"],["COMMAND_PRIORITY_REMOVED","Remover prioridade"],
  ["ITEM_ADDED","Adicionar item à comanda"],["ITEM_REMOVED","Excluir item da comanda"],["KITCHEN_SENT","Enviar para a cozinha"],["KITCHEN_STATUS_UPDATED","Atualizar preparo da cozinha"],
  ["SALE_COMPLETED","Fechar comanda/venda"],["QUICK_SALE_COMPLETED","Concluir venda rápida"],["QUICK_SALE_PENDING_DISCARDED","Descartar pendência de venda"],["DELIVERY_ORDER_CREATED","Criar pedido de delivery"],["DELIVERY_APP_CODE_UPDATED","Atualizar código do aplicativo"],["DELIVERY_READY","Pedido pronto para retirada"],["DELIVERY_PICKUP_CODE_FAILED","Recusar código de retirada"],["DELIVERY_COLLECTED","Confirmar retirada"],["DELIVERY_CANCELLED","Cancelar delivery"],["SALE_CANCELLED","Cancelar venda"],["SALE_MOVEMENT_UPDATED","Manutenção de movimento"],["CASH_OPENED","Abrir caixa"],["CASH_CLOSED","Fechar caixa"],
  ["PRODUCT_CREATED","Cadastrar produto"],["PRODUCT_UPDATED","Alterar produto"],["PRODUCT_FINANCE_UPDATED","Alterar custo e margem"],["PRODUCT_DELETED","Excluir produto"],["STOCK_ADJUSTED","Ajustar estoque"],["DRAFT_KEG_ADDED","Adicionar galão de chopp"],["TABLE_CREATED","Cadastrar mesa"],["TABLE_UPDATED","Alterar mesa"],["TABLES_COMBINED","Combinar mesas"],["TABLES_UNCOMBINED","Desfazer combinação"],["USER_CREATED","Cadastrar usuário"],
  ["USER_STATUS_CHANGED","Ativar ou inativar usuário"],["STAFF_MEMBER_CREATED","Cadastrar funcionário"],["STAFF_MEMBER_STATUS_CHANGED","Ativar ou inativar funcionário"],["STAFF_VOUCHER_SETTLED","Quitar vale de funcionário"],["PASSWORD_CHANGED","Alterar senha"],["PERMISSIONS_UPDATED","Alterar permissões"],["EVENT_CREATED","Cadastrar evento"],["EVENT_UPDATED","Alterar evento"],["EVENT_DELETED","Excluir evento"],
] as const;

export default async function LogsPage({searchParams}:{searchParams:Promise<{usuario?:string;movimento?:string}>}) {
  await requireRole(["ADMIN", "MANAGER"]);
  const params=await searchParams;
  const userId=/^\d+$/.test(params.usuario??"")?Number(params.usuario):null;
  const action=movementConfig.some(([key])=>key===params.movimento)?params.movimento??"":"";
  const [logs,users]=await Promise.all([
    query<AuditRow>(`SELECT al.id,al.action,al.entity_type,al.entity_id,al.description,al.created_at,
      COALESCE(u.name,'Usuário removido') AS user_name,u.username
      FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id
      WHERE ($1::bigint IS NULL OR al.user_id=$1) AND ($2::text='' OR al.action=$2)
      ORDER BY al.created_at DESC LIMIT 300`,[userId,action]),
    query<{id:number;name:string;username:string}>("SELECT id,name,username FROM users ORDER BY name"),
  ]);

  return <>
    <div className="page-head"><div><p className="eyebrow">Controle interno</p><h2>Histórico de atividades</h2><p>Filtre por funcionário e pela movimentação realizada no sistema.</p></div><span className="badge badge-blue"><ScrollText size={13}/> Até 300 registros</span></div>
    <form method="get" className="card log-filters"><div className="field"><label>Usuário</label><select className="select" name="usuario" defaultValue={params.usuario??""}><option value="">Todos os usuários</option>{users.rows.map((user)=><option value={user.id} key={user.id}>{user.name} (@{user.username})</option>)}</select></div><div className="field"><label>Movimentação</label><select className="select" name="movimento" defaultValue={action}><option value="">Todas as movimentações</option>{movementConfig.map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></div><div className="actions"><button className="btn btn-primary" type="submit"><Filter size={15}/> Filtrar</button><Link href="/logs" className="btn btn-light">Limpar</Link></div></form>
    <p className="log-result-count">{logs.rows.length} registro(s) encontrado(s)</p>
    {logs.rows.length===0?<div className="card empty">Nenhuma atividade encontrada com esses filtros.</div>:<div className="table-wrap audit-table"><table><thead><tr><th>Data e hora</th><th>Responsável</th><th>Atividade</th><th>Área</th></tr></thead><tbody>{logs.rows.map((log)=><tr key={log.id}><td className="number">{formatDateTime(log.created_at)}</td><td><strong>{log.user_name}</strong>{log.username&&<><br/><small>@{log.username}</small></>}</td><td>{log.description}</td><td><span className="badge badge-gray">{entityLabel[log.entity_type]??log.entity_type}{log.entity_id?` #${log.entity_id}`:""}</span></td></tr>)}</tbody></table></div>}
  </>;
}
