import { redirect } from "next/navigation";
import { setupAction } from "@/app/auth-actions";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const users = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
  if (Number(users.rows[0]?.count) > 0) redirect("/login");
  const { erro } = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark"><div className="brand-badge">P</div><span>O Pub do Bairro</span></div>
        <div><p className="eyebrow">Primeiro acesso</p><h1>Vamos abrir as portas.</h1><p>Crie a conta principal. Ela terá acesso administrativo para cadastrar a equipe e configurar o bar.</p></div>
        <small style={{ color: "#877f73" }}>Configuração inicial protegida</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Configuração</p><h2>Criar administrador</h2>
          {erro && <div className="alert alert-error">{erro}</div>}
          {!process.env.SETUP_KEY && <div className="alert alert-info">Defina a variável SETUP_KEY na Railway antes do primeiro acesso.</div>}
          <form action={setupAction} className="form-stack">
            <div className="field"><label>Chave de configuração</label><input className="input" name="setupKey" type="password" required /></div>
            <div className="field"><label>Nome</label><input className="input" name="name" required /></div>
            <div className="field"><label>Usuário</label><input className="input" name="username" minLength={3} required /></div>
            <div className="field"><label>Senha</label><input className="input" name="password" type="password" minLength={8} required /></div>
            <button className="btn btn-primary" type="submit">Criar conta e entrar</button>
          </form>
        </div>
      </section>
    </main>
  );
}
