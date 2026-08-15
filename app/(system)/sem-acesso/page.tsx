import { LockKeyhole } from "lucide-react";
import { requireUser } from "@/lib/auth";

export default async function NoAccessPage() {
  await requireUser();
  return <section className="card empty no-access"><LockKeyhole size={36}/><h2>Nenhum módulo liberado</h2><p>Peça a um Gerente ou Administrador para liberar os acessos necessários para o seu usuário.</p></section>;
}
