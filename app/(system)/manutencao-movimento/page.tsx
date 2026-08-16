import Link from "next/link";
import { Search, Wrench } from "lucide-react";
import { MovementMaintenanceButton } from "@/components/movement-maintenance-button";
import { requireRole } from "@/lib/auth";
import { commandLabel } from "@/lib/command-label";
import { query } from "@/lib/db";
import { formatDateInput, formatDateTime, formatMoney } from "@/lib/format";

type MovementRow={id:number;command_number:number|null;command_name:string|null;table_display:string;customer_name:string|null;customer_cpf:string|null;total_cents:number;status:string;created_at:string;payment_methods:string|null};

export default async function MovementMaintenancePage({searchParams}:{searchParams:Promise<{inicio?:string;fim?:string;pedido?:string;cliente?:string}>}){
  await requireRole(["ADMIN","MANAGER"]);
  const params=await searchParams;
  const today=formatDateInput();
  const start=/^\d{4}-\d{2}-\d{2}$/.test(params.inicio||"")?String(params.inicio):today;
  const end=/^\d{4}-\d{2}-\d{2}$/.test(params.fim||"")?String(params.fim):today;
  const order=String(params.pedido||"").trim();
  const customerSearch=String(params.cliente||"").trim();
  const customerDigits=customerSearch.replace(/\D/g,"");
  const [movements,customers,staffMembers]=await Promise.all([
    query<MovementRow>(`SELECT s.id,c.command_number,c.command_name,cl.display_label AS table_display,COALESCE(customer.name,c.customer_name) AS customer_name,customer.cpf AS customer_cpf,s.total_cents,s.status,s.created_at,
      (SELECT STRING_AGG(CASE p.method WHEN 'CASH' THEN 'Dinheiro' WHEN 'PIX' THEN 'PIX' WHEN 'DEBIT' THEN 'Débito' WHEN 'CREDIT' THEN 'Crédito' WHEN 'STAFF_VOUCHER' THEN 'Vale funcionário' WHEN 'STORE_CREDIT' THEN 'Crédito em loja' ELSE p.method END,', ' ORDER BY p.id) FROM payments p WHERE p.sale_id=s.id AND p.voided_at IS NULL) AS payment_methods
      FROM sales s JOIN commands c ON c.id=s.command_id JOIN command_locations cl ON cl.command_id=c.id LEFT JOIN customers customer ON customer.id=s.customer_id
      WHERE s.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND s.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND ($3='' OR s.id::text=$3 OR COALESCE(c.command_number::text,'')=$3)
        AND ($4='' OR COALESCE(customer.name,c.customer_name,'') ILIKE '%'||$4||'%' OR ($5<>'' AND COALESCE(customer.cpf,'') LIKE '%'||$5||'%'))
      ORDER BY s.created_at DESC LIMIT 300`,[start,end,order,customerSearch,customerDigits]),
    query<{id:number;name:string;cpf:string;store_credit_balance_cents:number;active:boolean}>("SELECT id,name,cpf,store_credit_balance_cents,active FROM customers ORDER BY active DESC,name"),
    query<{id:number;name:string;position:string|null}>("SELECT id,name,position FROM staff_members WHERE active=TRUE ORDER BY name"),
  ]);
  return <>
    <div className="page-head"><div><p className="eyebrow">Financeiro</p><h2>Manutenção de movimento</h2><p>Localize uma venda para corrigir o cliente ou reorganizar as formas de pagamento.</p></div><span className="badge badge-blue"><Wrench size={14}/> Acesso da gestão</span></div>
    <form method="get" className="card movement-filter-form"><div className="field"><label>Data inicial</label><input className="input" name="inicio" type="date" defaultValue={start} required/></div><div className="field"><label>Data final</label><input className="input" name="fim" type="date" defaultValue={end} required/></div><div className="field"><label>Nº do pedido ou comanda</label><input className="input" name="pedido" inputMode="numeric" defaultValue={order} placeholder="Ex.: 154"/></div><div className="field"><label>Nome do cliente ou CPF</label><input className="input" name="cliente" defaultValue={customerSearch} placeholder="Digite o nome ou CPF"/></div><button className="btn btn-primary" type="submit"><Search size={16}/> Localizar venda</button>{(order||customerSearch||start!==today||end!==today)&&<Link href="/manutencao-movimento" className="btn btn-light">Limpar filtros</Link>}</form>
    <section style={{marginTop:22}}><div className="page-head"><div><h3>Movimentos localizados</h3><p>{movements.rows.length} venda(s) encontrada(s). Clique no número para abrir a manutenção.</p></div></div>{movements.rows.length===0?<div className="card empty">Nenhuma venda encontrada com os filtros informados.</div>:<div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Comanda/Mesa</th><th>Cliente</th><th>Data</th><th>Pagamentos</th><th>Total</th><th>Situação</th></tr></thead><tbody>{movements.rows.map((movement)=><tr key={movement.id}><td><MovementMaintenanceButton saleId={movement.id} customers={customers.rows} staffMembers={staffMembers.rows}/></td><td>{commandLabel(movement)} · {movement.table_display}</td><td>{movement.customer_name||"Não vinculado"}{movement.customer_cpf&&<><br/><small>CPF {movement.customer_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}</small></>}</td><td>{formatDateTime(movement.created_at)}</td><td>{movement.payment_methods||"—"}</td><td className="money">{formatMoney(movement.total_cents)}</td><td><span className={`badge ${movement.status==="COMPLETED"?"badge-green":"badge-red"}`}>{movement.status==="COMPLETED"?"Concluída":"Cancelada"}</span></td></tr>)}</tbody></table></div>}</section>
  </>;
}
