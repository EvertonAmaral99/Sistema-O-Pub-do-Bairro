import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "@/lib/db";
import { firstAllowedPath, hasPermission, type Permission, type Role, type SessionUser } from "@/lib/roles";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "pub_session";

export type { Role, SessionUser } from "@/lib/roles";

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(hash, "hex");
  return storedBuffer.length === derived.length && timingSafeEqual(storedBuffer, derived);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, expires]);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await query<SessionUser>(
    `SELECT u.id, u.name, u.username, u.role,
       COALESCE(array_agg(up.permission) FILTER (WHERE up.permission IS NOT NULL), ARRAY[]::text[]) AS permissions
     FROM sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN user_permissions up ON up.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE
     GROUP BY u.id`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(`${firstAllowedPath(user)}?erro=permissao`);
  return user;
}

export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect(`${firstAllowedPath(user)}?erro=permissao`);
  return user;
}

export async function requireAnyPermission(permissions: Permission[]) {
  const user = await requireUser();
  if (!permissions.some((permission) => hasPermission(user, permission))) redirect(`${firstAllowedPath(user)}?erro=permissao`);
  return user;
}
