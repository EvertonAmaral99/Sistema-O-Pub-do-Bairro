export type Role = "ADMIN" | "MANAGER" | "CASHIER" | "KITCHEN" | "WAITER" | "ATTENDANT";
export type ModuleGroup = "OPERATION" | "REGISTRATION" | "INVENTORY" | "FINANCE" | "MANAGEMENT";

export const permissionConfig = [
  { key: "DASHBOARD", label: "Visão geral", description: "Painel com resumo do movimento", href: "/painel", group: "OPERATION" },
  { key: "COMMANDS", label: "Comandas", description: "Abrir, lançar e fechar comandas", href: "/comandas", group: "OPERATION" },
  { key: "QUICK_SALES", label: "Venda rápida", description: "Realizar vendas diretamente no caixa", href: "/venda-rapida", group: "OPERATION" },
  { key: "QUICK_SALE_PENDING", label: "Pendências de venda", description: "Salvar, consultar e retomar vendas rápidas", href: "/pendencias-venda", group: "OPERATION" },
  { key: "DELIVERY", label: "Delivery", description: "Acompanhar pedidos e liberar retiradas", href: "/delivery", group: "OPERATION" },
  { key: "KITCHEN", label: "Cozinha", description: "Visualizar e atualizar itens que precisam de preparo", href: "/cozinha", group: "OPERATION" },
  { key: "CUSTOMERS", label: "Clientes", description: "Cadastrar clientes e administrar créditos em loja", href: "/clientes", group: "REGISTRATION" },
  { key: "STAFF", label: "Funcionários", description: "Cadastrar funcionários vinculados a vales", href: "/funcionarios", group: "REGISTRATION", managementOnly: true },
  { key: "PRODUCTS", label: "Produtos", description: "Cadastrar produtos, preços e setor de preparo", href: "/produtos", group: "REGISTRATION" },
  { key: "STOCK", label: "Estoque", description: "Consultar e ajustar quantidades", href: "/estoque", group: "INVENTORY" },
  { key: "CASH", label: "Caixa", description: "Abrir, conferir e fechar o caixa", href: "/caixa", group: "FINANCE", managementOnly: true },
  { key: "FINANCE", label: "Financeiro", description: "Custos, margens, lucro e valor do estoque", href: "/financeiro", group: "FINANCE", managementOnly: true },
  { key: "PENDING_PAYMENTS", label: "Pagamentos pendentes", description: "Quitar e consultar vales de funcionários", href: "/pendencias", group: "FINANCE", managementOnly: true },
  { key: "MOVEMENT_MAINTENANCE", label: "Manutenção de movimentos", description: "Corrigir ou cancelar vendas concluídas", href: "/manutencao-movimento", group: "MANAGEMENT", managementOnly: true },
  { key: "REPORTS", label: "Relatórios", description: "Consultar vendas, produtos e resultados", href: "/relatorios", group: "MANAGEMENT", managementOnly: true },
  { key: "AGENDA", label: "Agenda", description: "Cadastrar e organizar eventos", href: "/agenda", group: "MANAGEMENT", managementOnly: true },
  { key: "AUDIT_LOGS", label: "Histórico", description: "Consultar ações e alterações do sistema", href: "/logs", group: "MANAGEMENT", managementOnly: true },
] as const;

export type Permission = (typeof permissionConfig)[number]["key"];
export const permissionKeys = permissionConfig.map((item) => item.key) as Permission[];

export const defaultPermissionsByRole: Record<Role, Permission[]> = {
  ADMIN: [...permissionKeys],
  MANAGER: [...permissionKeys],
  CASHIER: ["DASHBOARD", "COMMANDS", "QUICK_SALES", "QUICK_SALE_PENDING", "DELIVERY", "CUSTOMERS"],
  KITCHEN: ["DASHBOARD", "KITCHEN"],
  WAITER: ["DASHBOARD", "COMMANDS"],
  ATTENDANT: ["DASHBOARD", "COMMANDS"],
};

export type SessionUser = { id: number; name: string; username: string; role: Role; permissions: Permission[] };
export const roleLabel: Record<Role, string> = { ADMIN: "Administrador", MANAGER: "Gerente", CASHIER: "Caixa", KITCHEN: "Cozinha", WAITER: "Garçom", ATTENDANT: "Atendente" };

export function isManagementRole(role: Role) {
  return role === "ADMIN" || role === "MANAGER";
}

export function isManagementPermission(permission: Permission) {
  const item = permissionConfig.find((candidate) => candidate.key === permission);
  return Boolean(item && "managementOnly" in item && item.managementOnly);
}

export function canManageCommand(role: Role) {
  return role === "ADMIN" || role === "MANAGER" || role === "CASHIER";
}

export function isPermission(value: string): value is Permission {
  return permissionKeys.includes(value as Permission);
}

export function hasPermission(user: SessionUser, permission: Permission) {
  if (isManagementPermission(permission) && !isManagementRole(user.role)) return false;
  return user.role === "ADMIN" || user.permissions.includes(permission);
}

export function firstAllowedPath(user: SessionUser) {
  return permissionConfig.find((module) => hasPermission(user, module.key))?.href ?? "/configuracoes";
}
