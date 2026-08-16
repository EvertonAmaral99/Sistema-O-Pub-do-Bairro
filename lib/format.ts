export function formatMoney(cents: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents ?? 0) / 100);
}

export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export function formatDateInput(value: string | Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatQuantity(value: number | string, unit?: string) {
  const amount = Number(value);
  const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(amount);
  const labels: Record<string, string> = { UNIT: "un.", KG: "kg", L: "L", PORTION: "porção", DOSE: "dose", BOTTLE: "garrafa", CAN: "lata" };
  return `${formatted}${unit ? ` ${labels[unit] ?? unit}` : ""}`;
}

export function formatCpf(value: string) {
  const digits=value.replace(/\D/g,"").slice(0,11);
  if(digits.length!==11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4");
}
