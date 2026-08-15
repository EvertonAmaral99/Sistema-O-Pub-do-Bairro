export type Role = "ADMIN" | "MANAGER" | "CASHIER" | "KITCHEN";
export type SessionUser = { id: number; name: string; username: string; role: Role };
export const roleLabel: Record<Role, string> = { ADMIN: "Administrador", MANAGER: "Gerente", CASHIER: "Caixa", KITCHEN: "Cozinha" };
