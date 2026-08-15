"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { query } from "@/lib/db";

function go(path: string, message: string): never {
  redirect(`${path}?erro=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) go("/login", "Informe usuário e senha.");
  const result = await query<{ id: number; password_hash: string; active: boolean }>("SELECT id, password_hash, active FROM users WHERE username = $1", [username]);
  const account = result.rows[0];
  if (!account || !account.active || !(await verifyPassword(password, account.password_hash))) go("/login", "Usuário ou senha incorretos.");
  await createSession(account.id);
  redirect("/painel");
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
  const created = await query<{ id: number }>("INSERT INTO users (name, username, password_hash, role) VALUES ($1,$2,$3,'ADMIN') RETURNING id", [name, username, passwordHash]);
  await createSession(created.rows[0].id);
  redirect("/painel");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
