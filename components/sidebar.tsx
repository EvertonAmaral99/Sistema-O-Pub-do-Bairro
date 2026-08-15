"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, CalendarDays, ChefHat, CircleDollarSign, ClipboardList, LayoutDashboard, LogOut, Package, ScrollText, Settings } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import { BrandLogo } from "@/components/brand-logo";
import type { Permission, Role, SessionUser } from "@/lib/roles";
import { hasPermission, roleLabel } from "@/lib/roles";

type LinkItem = { href: string; label: string; icon: typeof LayoutDashboard; permission?: Permission; roles?: Role[] };
const links: LinkItem[] = [
  { href: "/painel", label: "Visão geral", icon: LayoutDashboard, permission: "DASHBOARD" },
  { href: "/comandas", label: "Comandas", icon: ClipboardList, permission: "COMMANDS" },
  { href: "/cozinha", label: "Cozinha e bar", icon: ChefHat, permission: "KITCHEN" },
  { href: "/produtos", label: "Produtos", icon: Package, permission: "PRODUCTS" },
  { href: "/estoque", label: "Estoque", icon: Boxes, permission: "STOCK" },
  { href: "/caixa", label: "Caixa", icon: CircleDollarSign, roles: ["ADMIN", "MANAGER"] },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, roles: ["ADMIN", "MANAGER"] },
  { href: "/configuracoes", label: "Configurações", icon: Settings, roles: ["ADMIN", "MANAGER", "CASHIER", "KITCHEN", "WAITER", "ATTENDANT"] },
  { href: "/logs", label: "Histórico", icon: ScrollText, roles: ["ADMIN", "MANAGER"] },
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand-mark"><BrandLogo className="sidebar-logo" priority /></div>
      <nav>
        {links.filter((link) => link.permission ? hasPermission(user, link.permission) : link.roles?.includes(user.role)).map((link) => {
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
