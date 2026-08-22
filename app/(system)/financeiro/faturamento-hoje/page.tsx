import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getCurrentCashRevenue } from "@/lib/current-cash-revenue";
import { TodayRevenueLive } from "./today-revenue-live";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TodayRevenuePage() {
  await requirePermission("FINANCE");
  const initialData = await getCurrentCashRevenue();

  return (
    <section className={styles.screen}>
      <div className={styles.topbar}>
        <Link className={styles.backLink} href="/financeiro"><ArrowLeft size={17}/> Financeiro</Link>
        <span className={styles.liveStatus} title="A tela consulta novas vendas automaticamente">
          <span className={styles.statusDot}/>
          <span>Atualização automática</span>
        </span>
      </div>
      <TodayRevenueLive initialData={initialData}/>
    </section>
  );
}
