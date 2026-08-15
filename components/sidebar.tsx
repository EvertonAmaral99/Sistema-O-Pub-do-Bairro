"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, ChefHat, CircleDollarSign, ClipboardList, LayoutDashboard, LogOut, Package, Settings } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import type { SessionUser } from "@/lib/roles";
import { roleLabel } from "@/lib/roles";

const links = [
  { href: "/painel", label: "Visão geral", icon: LayoutDashboard, roles: ["ADMIN","MANAGER","CASHIER","KITCHEN"] },
  { href: "/comandas", label: "Comandas", icon: ClipboardList, roles: ["ADMIN","MANAGER","CASHIER"] },
  { href: "/cozinha", label: "Cozinha e bar", icon: ChefHat, roles: ["ADMIN","MANAGER","KITCHEN"] },
  { href: "/produtos", label: "Produtos", icon: Package, roles: ["ADMIN","MANAGER"] },
  { href: "/estoque", label: "Estoque", icon: Boxes, roles: ["ADMIN","MANAGER"] },
  { href: "/caixa", label: "Caixa", icon: CircleDollarSign, roles: ["ADMIN","MANAGER","CASHIER"] },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["ADMIN","MANAGER"] },
  { href: "/configuracoes", label: "Configurações", icon: Settings, roles: ["ADMIN"] },
] as const;

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand-mark"><div className="brand-badge">P</div><span>O Pub do Bairro</span></div>
      <nav>
        {links.filter((link) => (link.roles as readonly string[]).includes(user.role)).map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return <Link key={link.href} href={link.href} className={`nav-link ${active ? "active" : ""}`}><Icon size={18}/><span>{link.label}</span></Link>;
        })}
      </nav>
      <div className="sidebar-user">
        <strong>{user.name}</strong><small>{roleLabel[user.role]}</small>
        <form action={logoutAction} style={{ marginTop: 12 }}><button className="btn btn-light btn-small" type="submit"><LogOut size={14}/> Sair</button></form>
      </div>
    </aside>
  );
}
