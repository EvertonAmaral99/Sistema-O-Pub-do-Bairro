"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CurrentCashRevenue } from "@/lib/current-cash-revenue";
import styles from "./page.module.css";

function formatUpdateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function TodayRevenueLive({ initialData }: { initialData: CurrentCashRevenue }) {
  const [data, setData] = useState(initialData);
  const [connected, setConnected] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/financeiro/faturamento-hoje", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Falha ao atualizar faturamento");
        const nextData = (await response.json()) as CurrentCashRevenue;
        if (disposed) return;
        setData(nextData);
        setConnected(true);
        setLastUpdatedAt(new Date().toISOString());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) setConnected(false);
      } finally {
        inFlight = false;
      }
    }

    const interval = window.setInterval(() => void refresh(), 2500);
    const refreshOnFocus = () => void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return (
    <>
      <div className={styles.center}>
        <div className={styles.hero}>
          <p className={styles.eyebrow}>Total previsto</p>
          <strong className={styles.amount} aria-live="polite">{formatMoney(data.totalCents)}</strong>

          <div className={styles.breakdown}>
            <div className={styles.breakdownCard}>
              <span>Já faturado</span>
              <strong>{formatMoney(data.revenueCents)}</strong>
              <small>{data.salesCount} venda(s) concluída(s) no caixa aberto</small>
            </div>
            <span className={styles.plus} aria-hidden="true">+</span>
            <div className={`${styles.breakdownCard} ${styles.pendingCard}`}>
              <span>Valor a entrar</span>
              <strong>{formatMoney(data.pendingCents)}</strong>
              <small>{data.pendingCount} comanda(s) aberta(s)</small>
            </div>
          </div>

          {data.cashOpen ? (
            <p className={styles.meta}>
              Caixa aberto{data.openedAt ? ` em ${formatDateTime(data.openedAt)}` : ""}
            </p>
          ) : (
            <span className={styles.cashClosed}><AlertCircle size={16}/> Nenhum caixa está aberto no momento</span>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        {!connected
          ? "Não foi possível atualizar agora. Os últimos valores recebidos continuam na tela e uma nova tentativa será feita automaticamente."
          : lastUpdatedAt
            ? `Atualizado automaticamente · última consulta às ${formatUpdateTime(lastUpdatedAt)}`
            : "Atualização automática ativa · nova consulta a cada 2,5 segundos"}
      </div>
    </>
  );
}
