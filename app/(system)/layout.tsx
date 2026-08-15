import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  return (
    <div className="app-shell">
      <Sidebar user={user}/>
      <div className="main-area">
        <header className="topbar"><h1>Gestão do bar</h1><span style={{ color: "var(--muted)", fontSize: 13, textTransform: "capitalize" }}>{today}</span></header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
