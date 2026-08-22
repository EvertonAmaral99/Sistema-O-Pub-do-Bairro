"use client";

import { CircleAlert, CircleCheck, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { closeCashAction } from "@/app/cash-command-actions";
import { PrintActionForm } from "@/components/print-action-form";

type PaymentTotals = {
  cash: number;
  pix: number;
  debit: number;
  credit: number;
  houseAccount: number;
  staffVoucher: number;
  storeCredit: number;
};

type ConfirmationKey = "closingAmount" | "confirmedPix" | "confirmedDebit" | "confirmedCredit" | "confirmedHouseAccount" | "confirmedStaffVoucher" | "confirmedStoreCredit";
type ClosingObservation = { amount: string; description: string };

function toCents(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : null;
}

function brl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function emptyObservation(): ClosingObservation {
  return { amount: "", description: "" };
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
    closingAmount: expectedCash === 0 ? "0.00" : "",
    confirmedPix: payments.pix === 0 ? "0.00" : "",
    confirmedDebit: payments.debit === 0 ? "0.00" : "",
    confirmedCredit: payments.credit === 0 ? "0.00" : "",
    confirmedHouseAccount: payments.houseAccount === 0 ? "0.00" : "",
    confirmedStaffVoucher: payments.staffVoucher === 0 ? "0.00" : "",
    confirmedStoreCredit: payments.storeCredit === 0 ? "0.00" : "",
  });
  const [observations, setObservations] = useState<ClosingObservation[]>([emptyObservation()]);

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
    { key: "confirmedHouseAccount", label: "Conta da casa conferida (R$)", expected: payments.houseAccount, help: "Total registrado como conta da casa" },
    { key: "confirmedStaffVoucher", label: "Vale conferido (R$)", expected: payments.staffVoucher, help: "Total registrado em vale" },
    { key: "confirmedStoreCredit", label: "Crédito em loja conferido (R$)", expected: payments.storeCredit, help: "Total usado dos créditos de clientes" },
  ];

  const checks = fields.map((field) => ({ ...field, informed: toCents(values[field.key]), matches: toCents(values[field.key]) === field.expected }));
  const paymentsReconciled = salesTotal === paymentsTotal;
  const readyToClose = paymentsReconciled && checks.every((check) => check.matches && check.informed !== null);
  const filledObservations = observations.filter((item) => item.amount.trim() || item.description.trim());
  const observationsComplete = filledObservations.every((item) => (toCents(item.amount) ?? 0) > 0 && item.description.trim().length > 0);
  const observationTotal = filledObservations.reduce((sum, item) => sum + (toCents(item.amount) ?? 0), 0);
  const closingObservations = filledObservations
    .filter((item) => (toCents(item.amount) ?? 0) > 0 && item.description.trim())
    .map((item) => ({ amountCents: toCents(item.amount) ?? 0, description: item.description.trim() }));

  function updateObservation(index: number, patch: Partial<ClosingObservation>) {
    setObservations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function addObservation() {
    setObservations((current) => current.length >= 30 ? current : [...current, emptyObservation()]);
  }

  function removeObservation(index: number) {
    setObservations((current) => current.length === 1 ? [emptyObservation()] : current.filter((_, itemIndex) => itemIndex !== index));
  }

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
        <input type="hidden" name="closingObservations" value={JSON.stringify(closingObservations)} />
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

        <section className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <strong>Observações do fechamento</strong>
              <div><small>Registre um valor e, ao lado, o motivo ou a descrição. Esses lançamentos são informativos e não alteram o caixa automaticamente.</small></div>
            </div>
            {observationTotal > 0 && <span className="badge badge-blue">Total: {brl(observationTotal)}</span>}
          </div>

          <div className="form-stack" style={{ gap: 10 }}>
            {observations.map((item, index) => (
              <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 0.35fr) minmax(220px, 1fr) auto", gap: 10, alignItems: "end" }}>
                <div className="field">
                  <label htmlFor={`closing-observation-amount-${index}`}>Valor (R$)</label>
                  <input
                    id={`closing-observation-amount-${index}`}
                    className="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={item.amount}
                    onChange={(event) => updateObservation(index, { amount: event.target.value })}
                    placeholder="0,00"
                    required={Boolean(item.description.trim())}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`closing-observation-description-${index}`}>Observação</label>
                  <input
                    id={`closing-observation-description-${index}`}
                    className="input"
                    type="text"
                    maxLength={180}
                    value={item.description}
                    onChange={(event) => updateObservation(index, { description: event.target.value })}
                    placeholder="Ex.: retirada para compra emergencial"
                    required={Boolean(item.amount.trim())}
                  />
                </div>
                <button className="btn btn-light btn-small" type="button" onClick={() => removeObservation(index)} aria-label={`Remover observação ${index + 1}`} title="Remover observação">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <button className="btn btn-light btn-small" type="button" onClick={addObservation} disabled={observations.length >= 30}>
              <Plus size={16} /> Adicionar observação
            </button>
            {!observationsComplete && <small style={{ color: "var(--danger, #b42318)" }}>Preencha o valor e a observação da linha utilizada.</small>}
          </div>
        </section>

        <div className="field">
          <label>Formato</label>
          <select className="select" name="format" defaultValue="58">
            <option value="58">Térmica 58 mm</option>
            <option value="a4">Folha A4</option>
          </select>
        </div>
        <button className="btn btn-dark" type="submit" disabled={!observationsComplete}>
          <Printer size={16} /> Fechar e imprimir relatório
        </button>
        {!readyToClose && (
          <small className="cash-closing-blocked">
            Preencha os valores conferidos. Ao continuar, o sistema validará todas as formas de pagamento e não fechará o caixa se houver alguma divergência.
          </small>
        )}
      </PrintActionForm>
    </section>
  );
}
