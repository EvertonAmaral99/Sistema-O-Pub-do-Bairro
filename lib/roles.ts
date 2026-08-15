export type Role = "ADMIN" | "MANAGER" | "CASHIER" | "KITCHEN";
export const permissionConfig = [
  { key: "DASHBOARD", label: "Visão geral", description: "Painel com resumo do movimento" },
  { key: "COMMANDS", label: "Comandas", description: "Abrir, lançar e fechar comandas" },
  { key: "KITCHEN", label: "Cozinha e bar", description: "Visualizar e atualizar pedidos" },
  { key: "PRODUCTS", label: "Produtos", description: "Cadastrar produtos e preços" },
  { key: "STOCK", label: "Estoque", description: "Consultar e ajustar quantidades" },
  { key: "CASH", label: "Caixa", description: "Abrir, movimentar e fechar o caixa" },
  { key: "REPORTS", label: "Relatórios", description: "Consultar vendas e cancelamentos" },
] as const;

export type Permission = (typeof permissionConfig)[number]["key"];
export const permissionKeys = permissionConfig.map((item) => item.key) as Permission[];

export const defaultPermissionsByRole: Record<Role, Permission[]> = {
  ADMIN: [...permissionKeys],
  MANAGER: [...permissionKeys],
  CASHIER: ["DASHBOARD", "COMMANDS", "CASH"],
  KITCHEN: ["DASHBOARD", "KITCHEN"],
};

export type SessionUser = { id: number; name: string; username: string; role: Role; permissions: Permission[] };
export const roleLabel: Record<Role, string> = { ADMIN: "Administrador", MANAGER: "Gerente", CASHIER: "Caixa", KITCHEN: "Cozinha" };

export function isPermission(value: string): value is Permission {
  return permissionKeys.includes(value as Permission);
}

export function hasPermission(user: SessionUser, permission: Permission) {
  return user.role === "ADMIN" || user.permissions.includes(permission);
}

export function firstAllowedPath(user: SessionUser) {
  const routes: Array<[Permission, string]> = [
    ["DASHBOARD", "/painel"], ["COMMANDS", "/comandas"], ["KITCHEN", "/cozinha"],
    ["PRODUCTS", "/produtos"], ["STOCK", "/estoque"], ["CASH", "/caixa"], ["REPORTS", "/relatorios"],
  ];
  return routes.find(([permission]) => hasPermission(user, permission))?.[1] ?? (user.role === "ADMIN" || user.role === "MANAGER" ? "/configuracoes" : "/sem-acesso");
}
