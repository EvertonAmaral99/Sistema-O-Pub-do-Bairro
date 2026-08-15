import { Info } from "lucide-react";

export function PriorityInfo({ note }: { note: string | null }) {
  if (!note) return null;
  return <span className="priority-info" tabIndex={0} aria-label={`Motivo da prioridade: ${note}`}>
    <Info size={14}/><span className="priority-tooltip">{note}</span>
  </span>;
}
