"use server";

import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { createSession, destroySession, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { defaultPermissionsByRole, firstAllowedPath, type Permission, type Role } from "@/lib/roles";

function go(path: string, message: string): never {
  redirect(`${path}?erro=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) go("/login", "Informe usuário e senha.");
  const result = await query<{ id: number; name: string; username: string; password_hash: string; active: boolean; role: Role; permissions: Permission[] }>(
    `SELECT u.id,u.name,u.username,u.password_hash,u.active,u.role,
       COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL),ARRAY[]::text[]) AS permissions
     FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id
     WHERE u.username=$1 GROUP BY u.id`,
    [username],
  );
  const account = result.rows[0];
  if (!account || !account.active || !(await verifyPassword(password, account.password_hash))) go("/login", "Usuário ou senha incorretos.");
  await createSession(account.id);
  await auditLog({ userId: account.id, action: "LOGIN", entityType: "SESSION", description: "Entrou no sistema." });
  redirect(firstAllowedPath(account));
}

export async function setupAction(formData: FormData) {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
  if (Number(existing.rows[0]?.count) > 0) redirect("/login");
  const setupKey = String(formData.get("setupKey") ?? "");
  if (!process.env.SETUP_KEY || setupKey !== process.env.SETUP_KEY) go("/setup", "Chave de configuração incorreta.");
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (name.length < 2 || username.length < 3 || password.length < 8) go("/setup", "Preencha os dados e use uma senha com pelo menos 8 caracteres.");
  const passwordHash = await hashPassword(password);
  const userId = await transaction(async (client) => {
    const created = await client.query<{ id: number }>("INSERT INTO users (name, username, password_hash, role) VALUES ($1,$2,$3,'ADMIN') RETURNING id", [name, username, passwordHash]);
    for (const permission of defaultPermissionsByRole.ADMIN) {
      await client.query("INSERT INTO user_permissions (user_id,permission) VALUES ($1,$2)", [created.rows[0].id, permission]);
    }
    await auditLog({ userId: created.rows[0].id, action: "SYSTEM_SETUP", entityType: "SYSTEM", description: "Criou o primeiro Administrador e configurou o sistema." }, client);
    return created.rows[0].id;
  });
  await createSession(userId);
  redirect("/painel");
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await auditLog({ userId: user.id, action: "LOGOUT", entityType: "SESSION", description: "Saiu do sistema." });
  await destroySession();
  redirect("/login");
}
