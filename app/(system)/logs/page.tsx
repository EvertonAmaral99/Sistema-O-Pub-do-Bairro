import { ScrollText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

type AuditRow = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  created_at: string;
  user_name: string;
  username: string | null;
};

const entityLabel: Record<string, string> = {
  CASH: "Caixa", COMMAND: "Comanda", KITCHEN_TICKET: "Produção", ORDER_ITEM: "Item",
  SALE: "Venda", PRODUCT: "Produto", TABLE: "Mesa", USER: "Usuário", SESSION: "Acesso", SYSTEM: "Sistema",
};

export default async function LogsPage() {
  await requireRole(["ADMIN", "MANAGER"]);
  const logs = await query<AuditRow>(`SELECT al.id,al.action,al.entity_type,al.entity_id,al.description,al.created_at,
    COALESCE(u.name,'Usuário removido') AS user_name,u.username
    FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id
    ORDER BY al.created_at DESC LIMIT 200`);

  return <>
    <div className="page-head"><div><p className="eyebrow">Controle interno</p><h2>Histórico de atividades</h2><p>Consulte quem realizou cada alteração e quando ela aconteceu.</p></div><span className="badge badge-blue"><ScrollText size={13}/> Últimos 200 registros</span></div>
    <div className="alert alert-info">O histórico passa a registrar as atividades realizadas após a instalação desta atualização.</div>
    {logs.rows.length === 0 ? <div className="card empty">Ainda não há atividades registradas.</div> : <div className="table-wrap audit-table"><table><thead><tr><th>Data e hora</th><th>Responsável</th><th>Atividade</th><th>Área</th></tr></thead><tbody>{logs.rows.map((log) => <tr key={log.id}>
      <td className="number">{formatDateTime(log.created_at)}</td>
      <td><strong>{log.user_name}</strong>{log.username && <><br/><small>@{log.username}</small></>}</td>
      <td>{log.description}</td>
      <td><span className="badge badge-gray">{entityLabel[log.entity_type] ?? log.entity_type}{log.entity_id ? ` #${log.entity_id}` : ""}</span></td>
    </tr>)}</tbody></table></div>}
  </>;
}
