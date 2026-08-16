import Link from "next/link";
import { BadgeDollarSign, Boxes, CircleDollarSign, PackageSearch, Percent, TrendingUp, WalletCards } from "lucide-react";
import { ProductMarginEditor } from "@/components/product-margin-editor";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatMoney, formatQuantity } from "@/lib/format";

type FinanceProduct = {
  id:number; name:string; category:string; cost_cents:number; price_cents:number; stock_pool_id:number;
  stock_quantity:number|string; stock_per_sale_unit:number|string; sale_unit:string; stock_kind:string|null; unlimited:boolean; active:boolean;
};

const periods={
  hoje:{label:"Caixa atual",filter:"AND s.cash_session_id=(SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1)"},
  mes:{label:"Este mês",filter:"AND s.created_at >= (date_trunc('month',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')"},
  tudo:{label:"Todo o período",filter:""},
} as const;

export default async function FinancePage({searchParams}:{searchParams:Promise<{periodo?:string;erro?:string;sucesso?:string}>}){
  await requirePermission("FINANCE");
  const params=await searchParams;
  const periodKey=params.periodo&&params.periodo in periods?params.periodo as keyof typeof periods:"mes";
  const period=periods[periodKey];
  const [sales,costs,products]=await Promise.all([
    query<{count:string;total:string}>(`SELECT COUNT(*)::text AS count,COALESCE(SUM(s.total_cents),0)::text AS total FROM sales s WHERE s.status='COMPLETED' ${period.filter}`),
    query<{total:string}>(`SELECT COALESCE(SUM(oi.unit_cost_cents*oi.quantity),0)::text AS total FROM order_items oi JOIN sales s ON s.command_id=oi.command_id WHERE s.status='COMPLETED' AND oi.status<>'CANCELLED' AND oi.product_name NOT ILIKE '%ESTOQUE%' ${period.filter}`),
    query<FinanceProduct>(`SELECT p.id,p.name,p.category,p.cost_cents,p.price_cents,p.stock_pool_id,sp.stock_quantity,p.stock_per_sale_unit,sp.sale_unit,sp.stock_kind,sp.unlimited,p.active FROM products p JOIN stock_pools sp ON sp.id=p.stock_pool_id WHERE p.deleted_at IS NULL AND p.name NOT ILIKE '%ESTOQUE%' ORDER BY (p.cost_cents=0) DESC,p.active DESC,p.category,p.name`),
  ]);
  const revenue=Number(sales.rows[0]?.total??0);
  const soldCost=Math.round(Number(costs.rows[0]?.total??0));
  const grossProfit=revenue-soldCost;
  const grossMargin=revenue>0?(grossProfit/revenue)*100:0;
  const pools=new Map<number,{stock:number;costBases:number[];priceBases:number[]}>();
  for(const product of products.rows){
    if(product.unlimited) continue;
    const factor=Math.max(0.001,Number(product.stock_per_sale_unit));
    const current=pools.get(product.stock_pool_id)??{stock:Number(product.stock_quantity),costBases:[],priceBases:[]};
    current.costBases.push(product.cost_cents/factor);
    current.priceBases.push(product.price_cents/factor);
    pools.set(product.stock_pool_id,current);
  }
  let inventoryCost=0;
  let inventoryRetail=0;
  for(const pool of pools.values()){
    inventoryCost+=pool.stock*(pool.costBases.reduce((sum,value)=>sum+value,0)/pool.costBases.length);
    inventoryRetail+=pool.stock*(pool.priceBases.reduce((sum,value)=>sum+value,0)/pool.priceBases.length);
  }
  inventoryCost=Math.round(inventoryCost);
  inventoryRetail=Math.round(inventoryRetail);
  const missingCosts=products.rows.filter((product)=>product.cost_cents===0).length;

  return <>
    <div className="page-head"><div><p className="eyebrow">Gestão financeira</p><h2>Financeiro</h2><p>Acompanhe custos, margens, lucro bruto e o valor financeiro do estoque.</p></div><div className="finance-periods">{Object.entries(periods).map(([key,value])=><Link className={`btn btn-small ${periodKey===key?"btn-primary":"btn-light"}`} href={`/financeiro?periodo=${key}`} key={key}>{value.label}</Link>)}</div></div>
    {params.erro&&<div className="alert alert-error">{params.erro}</div>}
    {params.sucesso&&<div className="alert alert-success">Custo, margem e preço do produto foram atualizados.</div>}
    {missingCosts>0&&<div className="alert alert-error"><PackageSearch size={17}/> {missingCosts} produto(s) ainda estão sem custo cadastrado. Enquanto isso, os cálculos de lucro e estoque ficam abaixo do valor real.</div>}

    <section className="finance-section">
      <div className="finance-section-head"><div><h3>Resultado — {period.label}</h3><p>Considera somente vendas concluídas no período escolhido.</p></div><span className="badge badge-blue">{sales.rows[0]?.count??0} venda(s)</span></div>
      <div className="finance-stat-grid">
        <div className="card stat"><span className="stat-label"><WalletCards size={16}/> Faturamento bruto</span><strong className="stat-value">{formatMoney(revenue)}</strong><span className="stat-meta">total das vendas concluídas</span></div>
        <div className="card stat"><span className="stat-label"><CircleDollarSign size={16}/> Custo dos itens vendidos</span><strong className="stat-value">{formatMoney(soldCost)}</strong><span className="stat-meta">custos registrados nas comandas</span></div>
        <div className="card stat"><span className="stat-label"><TrendingUp size={16}/> Lucro bruto</span><strong className={`stat-value ${grossProfit<0?"finance-negative":""}`}>{formatMoney(grossProfit)}</strong><span className="stat-meta">faturamento menos custo dos itens</span></div>
        <div className="card stat"><span className="stat-label"><Percent size={16}/> Margem bruta</span><strong className={`stat-value ${grossMargin<0?"finance-negative":""}`}>{grossMargin.toFixed(1).replace(".",",")}%</strong><span className="stat-meta">percentual sobre o faturamento</span></div>
      </div>
    </section>

    <section className="finance-section">
      <div className="finance-section-head"><div><h3>Valor do estoque atual</h3><p>Estoques compartilhados são contabilizados uma única vez pela média dos produtos vinculados.</p></div></div>
      <div className="finance-stat-grid finance-stat-grid-3">
        <div className="card stat"><span className="stat-label"><Boxes size={16}/> Estoque a custo</span><strong className="stat-value">{formatMoney(inventoryCost)}</strong><span className="stat-meta">capital estimado investido</span></div>
        <div className="card stat"><span className="stat-label"><BadgeDollarSign size={16}/> Estoque a preço de venda</span><strong className="stat-value">{formatMoney(inventoryRetail)}</strong><span className="stat-meta">valor bruto de venda do saldo</span></div>
        <div className="card stat"><span className="stat-label"><TrendingUp size={16}/> Lucro possível do estoque</span><strong className={`stat-value ${inventoryRetail-inventoryCost<0?"finance-negative":""}`}>{formatMoney(inventoryRetail-inventoryCost)}</strong><span className="stat-meta">antes de outras despesas</span></div>
      </div>
    </section>

    <section className="finance-section">
      <div className="finance-section-head"><div><h3>Custos e margens por produto</h3><p>Alterar a margem recalcula o preço. Alterar custo ou preço recalcula a margem.</p></div></div>
      <div className="table-wrap finance-products-table"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Ajuste financeiro</th></tr></thead><tbody>{products.rows.map((product)=><tr key={product.id}><td><strong>{product.name}</strong><br/><small>{product.category}</small>{!product.active&&<><br/><span className="badge badge-gray">Inativo</span></>}{product.cost_cents===0&&<><br/><span className="badge badge-red">Custo pendente</span></>}</td><td className="number">{product.unlimited?<span className="badge badge-blue">Ilimitado</span>:<>{formatQuantity(product.stock_quantity,product.sale_unit)}{product.stock_kind&&<><br/><small>saldo compartilhado</small></>}</>}</td><td><ProductMarginEditor productId={product.id} initialCostCents={product.cost_cents} initialPriceCents={product.price_cents}/></td></tr>)}</tbody></table></div>
    </section>
  </>;
}
