"use client";

import Link from "next/link";

export function PrintActions({ backHref }: { backHref?:string }) {
  return <div className="print-actions">{backHref?<Link className="btn btn-light" href={backHref}>Voltar</Link>:<button className="btn btn-light" onClick={() => window.close()}>Fechar</button>}<button className="btn btn-dark" onClick={() => window.print()}>Imprimir</button></div>;
}
