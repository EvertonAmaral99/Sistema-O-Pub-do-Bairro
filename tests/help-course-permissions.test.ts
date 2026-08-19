import assert from "node:assert/strict";
import test from "node:test";

import { canDownloadFullHelpManual, getHelpChaptersForUser } from "../lib/help-course-data";
import { defaultPermissionsByRole, type Role, type SessionUser } from "../lib/roles";

function user(role: Role, permissions = defaultPermissionsByRole[role]): SessionUser {
  return { id: 1, name: "Teste", username: "teste", role, permissions: [...permissions] };
}

function numbers(role: Role, permissions = defaultPermissionsByRole[role]) {
  return getHelpChaptersForUser(user(role, permissions)).map((chapter) => chapter.number);
}

test("Administrador recebe o manual completo e pode baixar o PDF", () => {
  assert.deepEqual(numbers("ADMIN"), Array.from({ length: 26 }, (_, index) => index + 1));
  assert.equal(canDownloadFullHelpManual(user("ADMIN")), true);
});

test("Cozinha recebe apenas a trilha operacional pertinente", () => {
  const visible = numbers("KITCHEN");
  assert.deepEqual(visible, [1, 2, 3, 4, 5, 11, 12, 23, 24, 25, 26]);
  assert.equal(visible.includes(18), false);
  assert.equal(visible.includes(19), false);
  assert.equal(canDownloadFullHelpManual(user("KITCHEN")), false);
});

test("Garçom não recebe fechamento de comanda nem módulos financeiros", () => {
  const visible = numbers("WAITER");
  assert.deepEqual(visible, [1, 2, 3, 4, 5, 6, 7, 12, 23, 24, 25, 26]);
  assert.equal(visible.includes(8), false);
  assert.equal(visible.includes(17), false);
});

test("Caixa recebe capítulos compatíveis com suas permissões e capacidade de fechamento", () => {
  const visible = numbers("CASHIER");
  assert.deepEqual(visible, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 23, 24, 25, 26]);
});

test("Permissão personalizada libera o capítulo correspondente sem liberar gestão", () => {
  const visible = numbers("ATTENDANT", ["DASHBOARD", "COMMANDS", "PRODUCTS"]);
  assert.equal(visible.includes(15), true);
  assert.equal(visible.includes(18), false);
  assert.equal(visible.includes(19), false);
});

test("Capítulo de configurações é reduzido à senha para não gerenciais", () => {
  const chapter = getHelpChaptersForUser(user("WAITER")).find((item) => item.number === 22);
  assert.ok(chapter);
  assert.deepEqual(chapter.sections.map((section) => section.title), ["Alterar a própria senha"]);
});

test("Agenda e histórico respeitam permissões separadamente", () => {
  const chapters = getHelpChaptersForUser(user("MANAGER", ["DASHBOARD", "AGENDA"]));
  const chapter = chapters.find((item) => item.number === 21);
  assert.ok(chapter);
  assert.equal(chapter.sections.some((section) => section.title === "Agenda de eventos"), true);
  assert.equal(chapter.sections.some((section) => section.title === "Histórico de atividades"), false);
});
