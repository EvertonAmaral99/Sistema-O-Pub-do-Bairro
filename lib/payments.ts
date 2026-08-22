export const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "DEBIT", label: "Cartão de débito" },
  { value: "CREDIT", label: "Cartão de crédito" },
  { value: "HOUSE_ACCOUNT", label: "Conta da casa" },
  { value: "STAFF_VOUCHER", label: "Vale funcionário" },
  { value: "STORE_CREDIT", label: "Crédito em loja" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];
export type BasePaymentMethod = Exclude<PaymentMethod, "STORE_CREDIT">;

export const BASE_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS.filter(
  (option): option is (typeof PAYMENT_METHOD_OPTIONS)[number] & { value: BasePaymentMethod } => option.value !== "STORE_CREDIT",
);

export const PAYMENT_METHOD_VALUES = PAYMENT_METHOD_OPTIONS.map((option) => option.value) as PaymentMethod[];
const paymentMethodSet = new Set<string>(PAYMENT_METHOD_VALUES);

export const PAYMENT_METHOD_LABELS = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PaymentMethod, string>;

export function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethodSet.has(value);
}

export function paymentMethodLabel(value: string) {
  return PAYMENT_METHOD_LABELS[value as PaymentMethod] ?? value;
}
