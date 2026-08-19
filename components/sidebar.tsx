"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bike, Boxes, CalendarDays, ChefHat, CircleDollarSign, ClipboardList, Clock3, ContactRound, FileClock, LayoutDashboard, LogOut, Menu, Package, ScrollText, Settings, ShoppingBasket, TrendingUp, UsersRound, Wrench, X, type LucideIcon } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import { BrandLogo } from "@/components/brand-logo";
import type { ModuleGroup, Permission, SessionUser } from "@/lib/roles";
import { hasPermission, permissionConfig, roleLabel } from "@/lib/roles";

const icons:Record<Permission,LucideIcon>={
  DASHBOARD:LayoutDashboard,COMMANDS:ClipboardList,QUICK_SALES:ShoppingBasket,QUICK_SALE_PENDING:FileClock,DELIVERY:Bike,KITCHEN:ChefHat,
  CUSTOMERS:ContactRound,STAFF:UsersRound,PRODUCTS:Package,STOCK:Boxes,CASH:CircleDollarSign,FINANCE:TrendingUp,
  PENDING_PAYMENTS:Clock3,MOVEMENT_MAINTENANCE:Wrench,REPORTS:BarChart3,AGENDA:CalendarDays,AUDIT_LOGS:ScrollText,
};
const groups:Array<{key:ModuleGroup;label:string}>=[
  {key:"OPERATION",label:"Operação"},{key:"REGISTRATION",label:"Cadastros"},{key:"INVENTORY",label:"Estoque"},{key:"FINANCE",label:"Financeiro"},{key:"MANAGEMENT",label:"Gestão"},
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [open,setOpen]=useState(false);
  const visibleModules=permissionConfig.filter((module)=>hasPermission(user,module.key));
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
        {groups.map((group)=>{
          const modules=visibleModules.filter((module)=>module.group===group.key);
          if(modules.length===0)return null;
          return <div className="nav-group" key={group.key}><span className="nav-group-label">{group.label}</span>{modules.map((module)=>{
            const Icon=icons[module.key];
            const active=pathname===module.href||pathname.startsWith(`${module.href}/`);
            return <Link key={module.key} href={module.href} onClick={()=>setOpen(false)} className={`nav-link ${active?"active":""}`}><Icon size={18}/><span>{module.label}</span></Link>;
          })}</div>;
        })}
        <div className="nav-group"><span className="nav-group-label">Conta</span><Link href="/configuracoes" onClick={()=>setOpen(false)} className={`nav-link ${pathname==="/configuracoes"||pathname.startsWith("/configuracoes/")?"active":""}`}><Settings size={18}/><span>Configurações</span></Link></div>
      </nav>
      <div className="sidebar-user">
        <strong>{user.name}</strong><small>{roleLabel[user.role]}</small>
        <form action={logoutAction} style={{ marginTop: 12 }}><button className="btn btn-light btn-small" type="submit"><LogOut size={14}/> Sair</button></form>
      </div>
      </aside>
    </>
  );
}
