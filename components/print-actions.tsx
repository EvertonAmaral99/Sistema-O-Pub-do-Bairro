"use client";

export function PrintActions() {
  return <div className="print-actions"><button className="btn btn-light" onClick={() => window.close()}>Fechar</button><button className="btn btn-dark" onClick={() => window.print()}>Imprimir</button></div>;
}
