"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bike, Boxes, CalendarDays, ChefHat, CircleDollarSign, ClipboardList, Clock3, ContactRound, FileClock, LayoutDashboard, LogOut, Menu, Package, ScrollText, Settings, ShoppingBasket, TrendingUp, UsersRound, Wrench, X } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import { BrandLogo } from "@/components/brand-logo";
import type { Permission, Role, SessionUser } from "@/lib/roles";
import { hasPermission, roleLabel } from "@/lib/roles";

type LinkItem = { href: string; label: string; icon: typeof LayoutDashboard; permission?: Permission; roles?: Role[] };
const links: LinkItem[] = [
  { href: "/painel", label: "Visão geral", icon: LayoutDashboard, permission: "DASHBOARD" },
  { href: "/comandas", label: "Comandas", icon: ClipboardList, permission: "COMMANDS" },
  { href: "/venda-rapida", label: "Venda rápida", icon: ShoppingBasket, roles: ["ADMIN", "MANAGER", "CASHIER"] },
  { href: "/pendencias-venda", label: "Pendências de venda", icon: FileClock, roles: ["ADMIN", "MANAGER", "CASHIER"] },
  { href: "/delivery", label: "Delivery", icon: Bike, roles: ["ADMIN", "MANAGER", "CASHIER"] },
  { href: "/clientes", label: "Clientes", icon: ContactRound, permission: "CUSTOMERS" },
  { href: "/funcionarios", label: "Funcionários", icon: UsersRound, roles: ["ADMIN", "MANAGER"] },
  { href: "/cozinha", label: "Cozinha", icon: ChefHat, permission: "KITCHEN" },
  { href: "/produtos", label: "Produtos", icon: Package, permission: "PRODUCTS" },
  { href: "/estoque", label: "Estoque", icon: Boxes, permission: "STOCK" },
  { href: "/caixa", label: "Caixa", icon: CircleDollarSign, roles: ["ADMIN", "MANAGER"] },
  { href: "/financeiro", label: "Financeiro", icon: TrendingUp, permission: "FINANCE" },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/manutencao-movimento", label: "Manutenção de movimento", icon: Wrench, roles: ["ADMIN", "MANAGER"] },
  { href: "/pendencias", label: "Pagamentos pendentes", icon: Clock3, roles: ["ADMIN", "MANAGER"] },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, roles: ["ADMIN", "MANAGER"] },
  { href: "/configuracoes", label: "Configurações", icon: Settings, roles: ["ADMIN", "MANAGER", "CASHIER", "KITCHEN", "WAITER", "ATTENDANT"] },
  { href: "/logs", label: "Histórico", icon: ScrollText, roles: ["ADMIN", "MANAGER"] },
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    document.body.classList.toggle("mobile-menu-open",open);
    return()=>document.body.classList.remove("mobile-menu-open");
  },[open]);
  return (
    <>
      <button className="mobile-menu-trigger" type="button" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={22}/></button>
      <button className={`sidebar-backdrop ${open?"visible":""}`} type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>
      <aside className={`sidebar ${open?"sidebar-open":""}`}>
      <div className="sidebar-mobile-head"><div className="brand-mark"><BrandLogo className="sidebar-logo" priority /></div><button className="sidebar-close" type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}><X size={22}/></button></div>
      <nav>
        {links.filter((link) => link.permission ? hasPermission(user, link.permission) : link.roles?.includes(user.role)).map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return <Link key={link.href} href={link.href} onClick={()=>setOpen(false)} className={`nav-link ${active ? "active" : ""}`}><Icon size={18}/><span>{link.label}</span></Link>;
        })}
      </nav>
      <div className="sidebar-user">
        <strong>{user.name}</strong><small>{roleLabel[user.role]}</small>
        <form action={logoutAction} style={{ marginTop: 12 }}><button className="btn btn-light btn-small" type="submit"><LogOut size={14}/> Sair</button></form>
      </div>
      </aside>
    </>
  );
}
