import { ContactRound, PlusCircle, WalletCards } from "lucide-react";
import { addCustomerCreditAction, createCustomerAction } from "@/app/system-actions";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCpf, formatDateTime, formatMoney } from "@/lib/format";

export default async function CustomersPage({searchParams}:{searchParams:Promise<{erro?:string;sucesso?:string}>}){
  await requirePermission("CUSTOMERS");
  const params=await searchParams;
  const [customers,movements]=await Promise.all([
    query<{id:number;name:string;cpf:string;contact:string;store_credit_balance_cents:number;active:boolean;created_at:string}>("SELECT id,name,cpf,contact,store_credit_balance_cents,active,created_at FROM customers ORDER BY active DESC,name"),
    query<{id:number;customer_name:string;amount_cents:number;movement_type:string;notes:string|null;created_at:string;user_name:string}>(`SELECT m.id,c.name AS customer_name,m.amount_cents,m.movement_type,m.notes,m.created_at,u.name AS user_name FROM customer_credit_movements m JOIN customers c ON c.id=m.customer_id JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC LIMIT 30`),
  ]);
  const movementLabels:Record<string,string>={CREDIT_GRANTED:"Crédito concedido",SALE_USED:"Usado em venda",SALE_REFUNDED:"Estornado por cancelamento",ADJUSTMENT:"Ajuste"};
  return <>
    <div className="page-head"><div><p className="eyebrow">Relacionamento</p><h2>Clientes e créditos</h2><p>Cadastre clientes e controle valores disponíveis para uma próxima compra.</p></div><span className="badge badge-blue"><ContactRound size={14}/> {customers.rows.length} cliente(s)</span></div>
    {params.erro&&<div className="alert alert-error">{params.erro}</div>}
    {params.sucesso&&<div className="alert alert-success">{params.sucesso==="credito"?"Crédito adicionado ao cliente.":"Cliente cadastrado."}</div>}
    <section className="card" style={{marginBottom:22}}><h3><PlusCircle size={17}/> Cadastrar cliente</h3><form action={createCustomerAction} className="form-grid"><div className="field"><label>Nome</label><input className="input" name="name" required/></div><div className="field"><label>CPF</label><input className="input" name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" required/></div><div className="field"><label>Contato</label><input className="input" name="contact" placeholder="Telefone ou WhatsApp" required/></div><div className="form-submit-field"><button className="btn btn-primary" type="submit">Cadastrar cliente</button></div></form></section>
    <section><h3>Clientes cadastrados</h3>{customers.rows.length===0?<div className="card empty">Nenhum cliente cadastrado.</div>:<div className="table-wrap"><table><thead><tr><th>Cliente</th><th>CPF</th><th>Contato</th><th>Crédito disponível</th><th>Gerar crédito</th></tr></thead><tbody>{customers.rows.map((customer)=><tr key={customer.id}><td><strong>{customer.name}</strong><br/><small>Desde {formatDateTime(customer.created_at)}</small></td><td>{formatCpf(customer.cpf)}</td><td>{customer.contact}</td><td className="money"><strong>{formatMoney(customer.store_credit_balance_cents)}</strong></td><td><form action={addCustomerCreditAction} className="customer-credit-form"><input type="hidden" name="customerId" value={customer.id}/><div className="field"><label>Valor (R$)</label><input className="input" name="amount" type="number" min="0.01" step="0.01" required/></div><div className="field"><label>Motivo</label><input className="input" name="notes" placeholder="Ex.: troco não entregue"/></div><button className="btn btn-light btn-small" type="submit"><WalletCards size={15}/> Adicionar</button></form></td></tr>)}</tbody></table></div>}</section>
    <section style={{marginTop:22}}><h3>Movimentações recentes de crédito</h3>{movements.rows.length===0?<div className="card empty">Nenhuma movimentação registrada.</div>:<div className="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Movimentação</th><th>Valor</th><th>Responsável</th></tr></thead><tbody>{movements.rows.map((movement)=><tr key={movement.id}><td>{formatDateTime(movement.created_at)}</td><td><strong>{movement.customer_name}</strong></td><td>{movementLabels[movement.movement_type]||movement.movement_type}{movement.notes&&<><br/><small>{movement.notes}</small></>}</td><td className={`money ${movement.amount_cents<0?"finance-negative":""}`}>{movement.amount_cents<0?"- ":"+ "}{formatMoney(Math.abs(movement.amount_cents))}</td><td>{movement.user_name}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
