import Link from "next/link";
import { formatDateTime, formatMoney } from "@/lib/format";
import { deliveryOrderLabel, deliveryStatusLabel } from "@/lib/delivery";

type DashboardDelivery = {
  id: number;
  sale_id: number;
  status: "PREPARING" | "READY";
  created_at: string;
  customer_name: string | null;
  item_count: string;
  total: string;
};

export function MotorcycleIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
    <circle cx="5" cy="17" r="3" />
    <circle cx="19" cy="17" r="3" />
    <path d="M5 17h6l2-4h3l3 4M8 17l-1.5-6H4m6 0h4l2 2m-1-5h3l1 3" />
  </svg>;
}

export function DashboardDeliveryCard({
  delivery,
  canOpenDelivery,
  canViewFinance,
}: {
  delivery: DashboardDelivery;
  canOpenDelivery: boolean;
  canViewFinance: boolean;
}) {
  const statusClass = delivery.status === "READY" ? "badge-green" : "badge-blue";
  const body = <>
    <div className="command-top">
      <span className="dashboard-delivery-identifier">
        <span className="dashboard-delivery-icon"><MotorcycleIcon size={20} /></span>
        <span><strong>{deliveryOrderLabel(Number(delivery.id))}</strong><small>Venda rápida #{delivery.sale_id} · Delivery</small></span>
      </span>
      <span className={`badge ${statusClass}`}>{deliveryStatusLabel[delivery.status]}</span>
    </div>
    <p>{delivery.customer_name || "Cliente não identificado"}<br />{formatDateTime(delivery.created_at)}</p>
    <div className="dashboard-delivery-footer">
      <span>{Number(delivery.item_count)} item(ns)</span>
      {canViewFinance && <strong className="money">{formatMoney(delivery.total)}</strong>}
    </div>
  </>;

  return <article className={`command-card dashboard-delivery-card ${delivery.status.toLocaleLowerCase()}`}>
    {canOpenDelivery
      ? <Link className="dashboard-delivery-link" href={`/delivery?pedido=${delivery.id}`} aria-label={`Abrir o delivery ${deliveryOrderLabel(Number(delivery.id))}`}>{body}</Link>
      : <div className="dashboard-delivery-link">{body}</div>}
  </article>;
}
