import assert from "node:assert/strict";
import test from "node:test";
import { courierAppCodeLabel, courierAppCodeState } from "../lib/delivery";
import {
  BASE_PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_VALUES,
  paymentMethodLabel,
} from "../lib/payments";
import { normalizeQuickSaleCheckoutDraft } from "../lib/quick-sale-draft";
import {
  defaultPermissionsByRole,
  hasPermission,
  isManagementPermission,
  permissionConfig,
  type SessionUser,
} from "../lib/roles";

test("mantém todas as formas de pagamento em uma única configuração", () => {
  assert.deepEqual(PAYMENT_METHOD_VALUES, ["CASH", "PIX", "DEBIT", "CREDIT", "STAFF_VOUCHER", "STORE_CREDIT"]);
  assert.equal(PAYMENT_METHOD_LABELS.STAFF_VOUCHER, "Vale funcionário");
  assert.equal(paymentMethodLabel("STORE_CREDIT"), "Crédito em loja");
  assert.deepEqual(BASE_PAYMENT_METHOD_OPTIONS.map((method) => method.value), ["CASH", "PIX", "DEBIT", "CREDIT", "STAFF_VOUCHER"]);
});

test("mantém rotas e chaves de módulos sem duplicidade", () => {
  const keys = permissionConfig.map((module) => module.key);
  const routes = permissionConfig.map((module) => module.href);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(routes).size, routes.length);
});

test("protege módulos de gestão e preserva os módulos operacionais do caixa", () => {
  assert.equal(isManagementPermission("MOVEMENT_MAINTENANCE"), true);
  assert.equal(isManagementPermission("REPORTS"), true);
  assert.equal(defaultPermissionsByRole.CASHIER.includes("QUICK_SALES"), true);
  assert.equal(defaultPermissionsByRole.CASHIER.includes("QUICK_SALE_PENDING"), true);
  assert.equal(defaultPermissionsByRole.CASHIER.includes("DELIVERY"), true);

  const cashier: SessionUser = {
    id: 1,
    name: "Caixa",
    username: "caixa",
    role: "CASHIER",
    permissions: [...defaultPermissionsByRole.CASHIER, "REPORTS"],
  };
  assert.equal(hasPermission(cashier, "QUICK_SALES"), true);
  assert.equal(hasPermission(cashier, "REPORTS"), false);
});

test("normaliza o rascunho do delivery sem o campo antigo de aplicativo ou serviço", () => {
  const draft = normalizeQuickSaleCheckoutDraft({
    fulfillmentType: "APP_PICKUP",
    courierAppName: "campo antigo",
    courierAppCode: "ABC-123",
  });
  assert.equal(draft.fulfillmentType, "APP_PICKUP");
  assert.equal(draft.courierAppCode, "ABC-123");
  assert.equal("courierAppName" in draft, false);
});

test("diferencia código informado, ausência confirmada e código pendente no delivery", () => {
  assert.equal(courierAppCodeState("APP-123", false), "INFORMED");
  assert.equal(courierAppCodeState(null, true), "NOT_REQUIRED");
  assert.equal(courierAppCodeState(null, false), "PENDING");
  assert.equal(courierAppCodeLabel(null, true), "Sem código");
  assert.equal(courierAppCodeLabel(null, false), "Pendente");
});
