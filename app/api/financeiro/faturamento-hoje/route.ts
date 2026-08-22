import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentCashRevenue } from "@/lib/current-cash-revenue";
import { hasPermission } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (!hasPermission(user, "FINANCE")) return NextResponse.json({ error: "Seu perfil não pode acessar o faturamento." }, { status: 403 });

  const data = await getCurrentCashRevenue();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
