export type PrintFormat = "58" | "a4";

export function normalizePrintFormat(value: unknown): PrintFormat {
  return value === "a4" ? "a4" : "58";
}
