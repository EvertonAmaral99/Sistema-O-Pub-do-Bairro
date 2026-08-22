"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CurrentCashRevenue } from "@/lib/current-cash-revenue";
import styles from "./page.module.css";

export function TodayRevenueLive({ initialData }: { initialData: CurrentCashRevenue }) {
  const [data, setData] = useState(initialData);
  const [connected, setConnected] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date());

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;

    async function refresh() {
      controller?.abort();
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
        setLastUpdatedAt(new Date());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) setConnected(false);
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
          <p className={styles.eyebrow}>Faturamento do caixa aberto</p>
          <strong className={styles.amount} aria-live="polite">{formatMoney(data.revenueCents)}</strong>
          {data.cashOpen ? (
            <p className={styles.meta}>
              {data.salesCount} venda(s) concluída(s) neste caixa
              {data.openedAt ? ` · aberto em ${formatDateTime(data.openedAt)}` : ""}
            </p>
          ) : (
            <span className={styles.cashClosed}><AlertCircle size={16}/> Nenhum caixa está aberto no momento</span>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        {connected
          ? `Atualizado automaticamente · última consulta às ${lastUpdatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : "Não foi possível atualizar agora. O último valor recebido continua na tela e uma nova tentativa será feita automaticamente."}
      </div>
    </>
  );
}
