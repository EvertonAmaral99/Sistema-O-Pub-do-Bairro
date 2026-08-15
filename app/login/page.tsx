import { redirect } from "next/navigation";
import { loginAction } from "@/app/auth-actions";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await getCurrentUser()) redirect("/painel");
  const users = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
  if (Number(users.rows[0]?.count) === 0) redirect("/setup");
  const { erro } = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark"><div className="brand-badge">P</div><span>O Pub do Bairro</span></div>
        <div>
          <p className="eyebrow">Gestão do bar</p>
          <h1>Seu atendimento, em uma só tela.</h1>
          <p>Comandas, cozinha, estoque e caixa organizados para uma operação mais tranquila.</p>
        </div>
        <small style={{ color: "#877f73" }}>Acesso restrito à equipe</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Bem-vindo</p>
          <h2>Entrar no sistema</h2>
          <p style={{ color: "var(--muted)", marginBottom: 28 }}>Use seu usuário e senha cadastrados.</p>
          {erro && <div className="alert alert-error">{erro}</div>}
          <form action={loginAction} className="form-stack">
            <div className="field"><label htmlFor="username">Usuário</label><input className="input" id="username" name="username" autoComplete="username" required autoFocus /></div>
            <div className="field"><label htmlFor="password">Senha</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <button className="btn btn-primary" type="submit">Acessar sistema</button>
          </form>
        </div>
      </section>
    </main>
  );
}
