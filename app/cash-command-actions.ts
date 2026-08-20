"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { commandLabel } from "@/lib/command-label";
import { transaction } from "@/lib/db";

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cents(value: FormDataEntryValue | null) {
  return Math.max(0, Math.round(numberValue(value) * 100));
}

function positiveId(value: FormDataEntryValue | null) {
  const id = Math.trunc(numberValue(value));
  if (id < 1) throw new Error("Registro inválido.");
  return id;
}

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}erro=${encodeURIComponent(message)}`);
}

function moneyText(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export async function openCommandAction(formData: FormData) {
  const user = await requirePermission("COMMANDS");
  const commandNumberText = String(formData.get("commandNumber") ?? "").trim();
  const commandNumber = commandNumberText ? Number(commandNumberText) : null;
  const commandName = String(formData.get("commandName") ?? "").trim().replace(/\s+/g, " ") || null;
  const tableIds = [...new Set(formData.getAll("tableIds").map((value) => Math.trunc(numberValue(value))).filter((id) => id > 0))];

  if (commandNumber !== null && (!Number.isSafeInteger(commandNumber) || commandNumber < 1 || commandNumber > 2147483647)) {
    fail("/comandas", "Informe um número de comanda válido.");
  }
  if (commandNumber === null && !commandName) fail("/comandas", "Informe o número ou o nome da comanda.");
  if (commandName && commandName.length > 80) fail("/comandas", "O nome da comanda deve ter no máximo 80 caracteres.");

  let commandId = 0;
  try {
    commandId = await transaction(async (client) => {
      const cash = await client.query<{ id: number }>("SELECT id FROM cash_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1 FOR UPDATE");
      if (!cash.rows[0]) throw new Error("Abra o caixa antes de abrir uma comanda.");

      const tables = await client.query<{ id: number; label: string; active: boolean }>(
        "SELECT id,COALESCE(label,'Mesa '||number) AS label,active FROM bar_tables WHERE id=ANY($1::bigint[]) ORDER BY number FOR UPDATE",
        [tableIds],
      );
      if (tables.rows.length !== tableIds.length || tables.rows.some((table) => !table.active)) {
        throw new Error("Uma das mesas selecionadas está indisponível.");
      }

      const primaryTableId = tables.rows[0]?.id ?? null;
      const created = await client.query<{ id: number }>(
        "INSERT INTO commands (command_number,command_name,table_id,opened_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [commandNumber, commandName, primaryTableId, user.id],
      );
      for (const table of tables.rows) {
        await client.query("INSERT INTO command_tables (command_id,table_id) VALUES ($1,$2)", [created.rows[0].id, table.id]);
      }

      const displayLabel = tables.rows.length > 0 ? tables.rows.map((table) => table.label).join(" + ") : "Sem mesa";
      const locationText = tables.rows.length > 0 ? `em ${displayLabel}` : "sem mesa vinculada";
      await auditLog(
        {
          userId: user.id,
          action: "COMMAND_OPENED",
          entityType: "COMMAND",
          entityId: created.rows[0].id,
          description: `Abriu a comanda ${commandLabel({ command_number: commandNumber, command_name: commandName })} ${locationText}.`,
          metadata: {
            commandNumber,
            commandName,
            tableIds: tables.rows.map((table) => table.id),
            table: tables.rows.length > 0 ? displayLabel : null,
            cashSessionId: cash.rows[0].id,
          },
        },
        client,
      );
      return created.rows[0].id;
    });
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    const message = error instanceof Error ? error.message : "Não foi possível abrir a comanda.";
    if (databaseError.code === "23505") {
      fail("/comandas", databaseError.constraint === "commands_open_name_idx" ? "Já existe uma comanda aberta com esse nome." : "Esse número de comanda já está em uso.");
    }
    fail("/comandas", message);
  }

  revalidatePath("/comandas");
  revalidatePath("/painel");
  redirect(`/comandas/${commandId}`);
}

export async function closeCashAction(formData: FormData): Promise<{ url?: string; error?: string }> {
  const user = await requirePermission("CASH");
  const cashId = positiveId(formData.get("cashId"));
  const format = String(formData.get("format") ?? "58");
  const closingAmount = cents(formData.get("closingAmount"));
  const confirmedPayments = {
    PIX: cents(formData.get("confirmedPix")),
    DEBIT: cents(formData.get("confirmedDebit")),
    CREDIT: cents(formData.get("confirmedCredit")),
    STAFF_VOUCHER: cents(formData.get("confirmedStaffVoucher")),
    STORE_CREDIT: cents(formData.get("confirmedStoreCredit")),
  };
  const notes = String(formData.get("notes") ?? "").trim() || null;

  try {
    await transaction(async (client) => {
      // O caixa é travado antes da checagem de comandas. A abertura de comanda usa a mesma trava,
      // impedindo que uma comanda seja criada ao mesmo tempo em que o caixa está sendo encerrado.
      const current = await client.query<{ opening_amount_cents: number }>(
        "SELECT opening_amount_cents FROM cash_sessions WHERE id=$1 AND status='OPEN' FOR UPDATE",
        [cashId],
      );
      if (!current.rows[0]) throw new Error("Caixa não encontrado ou já fechado.");

      const openCommands = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM commands WHERE status='OPEN'");
      if (Number(openCommands.rows[0]?.count) > 0) throw new Error("Feche as comandas abertas antes de encerrar o caixa.");

      const [sales, paymentRows] = await Promise.all([
        client.query<{ total: string }>("SELECT COALESCE(SUM(total_cents),0)::text AS total FROM sales WHERE cash_session_id=$1 AND status='COMPLETED'", [cashId]),
        client.query<{ method: string; total: string }>(
          `SELECT p.method,COALESCE(SUM(p.amount_cents),0)::text AS total
           FROM payments p JOIN sales s ON s.id=p.sale_id
           WHERE s.cash_session_id=$1 AND s.status='COMPLETED' AND p.voided_at IS NULL
           GROUP BY p.method`,
          [cashId],
        ),
      ]);

      const paymentTotals = Object.fromEntries(paymentRows.rows.map((row) => [row.method, Number(row.total)])) as Record<string, number>;
      const salesTotal = Number(sales.rows[0]?.total ?? 0);
      const paymentsTotal = Object.values(paymentTotals).reduce((sum, value) => sum + value, 0);
      if (salesTotal !== paymentsTotal) {
        throw new Error(`O total das vendas (${moneyText(salesTotal)}) não confere com os pagamentos registrados (${moneyText(paymentsTotal)}). Revise as vendas antes de fechar o caixa.`);
      }

      for (const [method, confirmed] of Object.entries(confirmedPayments)) {
        const registered = paymentTotals[method] ?? 0;
        if (confirmed !== registered) {
          const labels: Record<string, string> = {
            PIX: "PIX",
            DEBIT: "débito",
            CREDIT: "crédito",
            STAFF_VOUCHER: "vale funcionário",
            STORE_CREDIT: "crédito em loja",
          };
          throw new Error(`O valor conferido em ${labels[method]} não confere. Registrado no sistema: ${moneyText(registered)}.`);
        }
      }

      const cashSales = paymentTotals.CASH ?? 0;
      const expected = Number(current.rows[0].opening_amount_cents) + cashSales;
      if (closingAmount !== expected) {
        throw new Error(`O dinheiro contado não confere. Deve haver ${moneyText(expected)} em espécie: ${moneyText(current.rows[0].opening_amount_cents)} de fundo + ${moneyText(cashSales)} das vendas.`);
      }

      await client.query(
        "UPDATE cash_sessions SET status='CLOSED',closed_by=$1,closed_at=NOW(),closing_amount_cents=$2,expected_amount_cents=$3,notes=$4 WHERE id=$5 AND status='OPEN'",
        [user.id, closingAmount, expected, notes, cashId],
      );
      await auditLog(
        {
          userId: user.id,
          action: "CASH_CLOSED",
          entityType: "CASH",
          entityId: cashId,
          description: `Fechou o caixa após conferir ${moneyText(salesTotal)} em vendas e ${moneyText(expected)} em espécie.`,
          metadata: { openingAmount: current.rows[0].opening_amount_cents, salesTotal, paymentsTotal, paymentTotals, closingAmount, expected },
        },
        client,
      );
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível fechar o caixa." };
  }

  revalidatePath("/caixa");
  revalidatePath("/comandas");
  return { url: `/imprimir/caixa/${cashId}?formato=${encodeURIComponent(format)}` };
}
