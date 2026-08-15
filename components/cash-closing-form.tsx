"use client";

import { CircleAlert, CircleCheck, Printer } from "lucide-react";
import { useState } from "react";
import { closeCashAction } from "@/app/system-actions";
import { PrintActionForm } from "@/components/print-action-form";

type PaymentTotals = {
  cash: number;
  pix: number;
  debit: number;
  credit: number;
  staffVoucher: number;
};

type ConfirmationKey = "closingAmount" | "confirmedPix" | "confirmedDebit" | "confirmedCredit" | "confirmedStaffVoucher";

function toCents(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : null;
}

function brl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function CashClosingForm({
  cashId,
  openingAmount,
  salesTotal,
  paymentsTotal,
  payments,
}: {
  cashId: number;
  openingAmount: number;
  salesTotal: number;
  paymentsTotal: number;
  payments: PaymentTotals;
}) {
  const expectedCash = openingAmount + payments.cash;
  const [values, setValues] = useState<Record<ConfirmationKey, string>>({
    closingAmount: "",
    confirmedPix: "",
    confirmedDebit: "",
    confirmedCredit: "",
    confirmedStaffVoucher: "",
  });

  const fields: Array<{ key: ConfirmationKey; label: string; expected: number; help: string }> = [
    {
      key: "closingAmount",
      label: "Dinheiro físico contado (R$)",
      expected: expectedCash,
      help: `${brl(openingAmount)} de fundo + ${brl(payments.cash)} das vendas`,
    },
    { key: "confirmedPix", label: "PIX conferido (R$)", expected: payments.pix, help: "Total registrado em PIX" },
    { key: "confirmedDebit", label: "Débito conferido (R$)", expected: payments.debit, help: "Total registrado em débito" },
    { key: "confirmedCredit", label: "Crédito conferido (R$)", expected: payments.credit, help: "Total registrado em crédito" },
    { key: "confirmedStaffVoucher", label: "Vale conferido (R$)", expected: payments.staffVoucher, help: "Total registrado em vale" },
  ];

  const checks = fields.map((field) => ({ ...field, informed: toCents(values[field.key]), matches: toCents(values[field.key]) === field.expected }));
  const paymentsReconciled = salesTotal === paymentsTotal;
  const readyToClose = paymentsReconciled && checks.every((check) => check.matches && check.informed !== null);

  return (
    <section className="card cash-closing-card">
      <h3>Conferência para fechar o caixa</h3>
      <p className="cash-closing-intro">
        Digite os valores conferidos. O fechamento será liberado somente quando todas as formas de pagamento coincidirem com o sistema.
      </p>

      <div className={`cash-reconciliation ${paymentsReconciled ? "cash-reconciliation-ok" : "cash-reconciliation-error"}`}>
        <div>
          <small>Total das vendas</small>
          <strong>{brl(salesTotal)}</strong>
        </div>
        <div>
          <small>Total dos pagamentos</small>
          <strong>{brl(paymentsTotal)}</strong>
        </div>
        <span>
          {paymentsReconciled ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          {paymentsReconciled ? "Registros conferem" : "Há diferença nos registros"}
        </span>
      </div>

      <PrintActionForm action={closeCashAction} className="form-stack">
        <input type="hidden" name="cashId" value={cashId} />
        <div className="cash-confirmation-grid">
          {checks.map((field) => (
            <div className={`field cash-confirmation-field ${field.informed !== null ? (field.matches ? "cash-confirmation-ok" : "cash-confirmation-error") : ""}`} key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <input
                className="input"
                id={field.key}
                name={field.key}
                type="number"
                min="0"
                step="0.01"
                value={values[field.key]}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                required
              />
              <small>
                Esperado: <strong>{brl(field.expected)}</strong> · {field.help}
              </small>
              {field.informed !== null && (
                <span className="cash-confirmation-status">
                  {field.matches ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
                  {field.matches ? "Confere" : `Diferença de ${brl(Math.abs(field.informed - field.expected))}`}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="field">
          <label>Observações</label>
          <textarea className="textarea" name="notes" rows={3} />
        </div>
        <div className="field">
          <label>Formato</label>
          <select className="select" name="format" defaultValue="a4">
            <option value="80">Térmica 80 mm</option>
            <option value="58">Térmica 58 mm</option>
            <option value="a4">Folha A4</option>
          </select>
        </div>
        <button className="btn btn-dark" type="submit" disabled={!readyToClose}>
          <Printer size={16} /> Fechar e imprimir relatório
        </button>
        {!readyToClose && <small className="cash-closing-blocked">Confira todos os valores para liberar o fechamento.</small>}
      </PrintActionForm>
    </section>
  );
}
