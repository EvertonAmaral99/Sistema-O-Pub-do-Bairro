import { Sidebar } from "@/components/sidebar";
import { BrandLogo } from "@/components/brand-logo";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  return (
    <div className="app-shell">
      <Sidebar user={user}/>
      <div className="main-area">
        <header className="topbar"><div className="topbar-brand"><BrandLogo className="topbar-logo" priority /><h1>Gestão do bar</h1></div><div className="topbar-user"><strong>{user.name}</strong><span>{today}</span></div></header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
