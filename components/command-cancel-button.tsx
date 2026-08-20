"use client";

import { useRef } from "react";
import { Trash2, X } from "lucide-react";
import { cancelCommandAction } from "@/app/system-actions";

export function CommandCancelButton({
  commandId,
  commandLabel,
  tableDisplay,
}: {
  commandId: number;
  commandLabel: string;
  tableDisplay: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="command-card-delete"
        type="button"
        aria-label={`Cancelar ${commandLabel}`}
        title="Cancelar comanda"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 size={17} />
      </button>

      <dialog className="command-cancel-dialog" ref={dialogRef}>
        <div className="command-cancel-dialog-head">
          <div>
            <span className="eyebrow">Confirmação</span>
            <h3>Cancelar {commandLabel}?</h3>
            <p>{tableDisplay}</p>
          </div>
          <form method="dialog">
            <button className="command-cancel-dialog-close" type="submit" aria-label="Fechar">
              <X size={19} />
            </button>
          </form>
        </div>

        <div className="alert alert-error command-cancel-warning">
          A comanda deixará de aparecer entre as comandas abertas e os itens serão devolvidos ao estoque. O cancelamento e o motivo ficarão registrados no histórico do sistema.
        </div>

        <form action={cancelCommandAction} className="form-stack">
          <input type="hidden" name="commandId" value={commandId} />
          <div className="field">
            <label htmlFor={`cancel-command-reason-${commandId}`}>Motivo do cancelamento</label>
            <textarea
              className="textarea"
              id={`cancel-command-reason-${commandId}`}
              name="reason"
              minLength={3}
              maxLength={240}
              rows={4}
              placeholder="Informe por que esta comanda está sendo cancelada"
              required
              autoFocus
            />
          </div>
          <div className="command-cancel-dialog-actions">
            <button className="btn btn-light" type="button" onClick={() => dialogRef.current?.close()}>
              Voltar
            </button>
            <button className="btn btn-danger" type="submit">
              <Trash2 size={16} /> Confirmar cancelamento
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
