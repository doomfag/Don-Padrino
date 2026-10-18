import { test } from "node:test";
import assert from "node:assert/strict";
import { getAvailability } from "../hours.mjs";
const shop = { acceptingOrders: true, enforceHours: true };
for (const day of [15, 16, 17, 18]) {
  test(`aceita pedidos em ${day}/10/2026 somente entre 18h e meia-noite de Brasília`, () => {
    assert.equal(
      getAvailability(shop, new Date(`2026-10-${day}T20:59:59Z`)).open,
      false,
    );
    assert.equal(
      getAvailability(shop, new Date(`2026-10-${day}T21:00:00Z`)).open,
      true,
    );
    const end = new Date(Date.UTC(2026, 9, day + 1, 2, 59, 59));
    assert.equal(getAvailability(shop, end).open, true);
    const midnight = new Date(Date.UTC(2026, 9, day + 1, 3));
    assert.equal(getAvailability(shop, midnight).open, false);
  });
}
test("segunda, terça e quarta ficam fechadas também à noite", () => {
  for (const day of [19, 20, 21]) {
    const state = getAvailability(shop, new Date(`2026-10-${day}T22:00:00Z`));
    assert.equal(state.open, false);
    assert.equal(state.nextOpenAt, "2026-10-22T21:00:00.000Z");
  }
});
test("informa hoje, amanhã ou o próximo dia certo sem usar o fuso do cliente", () => {
  assert.match(
    getAvailability(shop, new Date("2026-10-18T13:00:00Z")).message,
    /hoje às 18h/,
  );
  assert.match(
    getAvailability(shop, new Date("2026-10-21T22:00:00Z")).message,
    /amanhã às 18h/,
  );
  assert.match(
    getAvailability(shop, new Date("2026-10-19T13:00:00Z")).message,
    /quinta-feira às 18h/,
  );
  assert.equal(
    getAvailability(shop, new Date("2026-10-19T03:00:00Z")).nextOpenAt,
    "2026-10-22T21:00:00.000Z",
  );
  assert.equal(
    getAvailability(shop, new Date("2026-10-18T21:00:00Z")).nextCloseAt,
    "2026-10-19T03:00:00.000Z",
  );
});
test("virada de ano mantém o fechamento à meia-noite", () => {
  const state = getAvailability(shop, new Date("2027-01-01T02:59:59Z"));
  assert.equal(state.open, true);
  assert.equal(state.nextCloseAt, "2027-01-01T03:00:00.000Z");
  assert.equal(
    getAvailability(shop, new Date("2027-01-01T03:00:00Z")).nextOpenAt,
    "2027-01-01T21:00:00.000Z",
  );
});
test("pausa administrativa prevalece sobre abertura e exceção de horário", () => {
  const paused = getAvailability(
    { ...shop, acceptingOrders: false, enforceHours: false },
    new Date("2026-10-18T22:00:00Z"),
  );
  assert.equal(paused.open, false);
  assert.equal(paused.reason, "paused");
  assert.equal(paused.nextOpenAt, null);
  assert.match(paused.message, /pausados/);
  const special = getAvailability(
    { ...shop, enforceHours: false },
    new Date("2026-10-19T13:00:00Z"),
  );
  assert.equal(special.open, true);
  assert.equal(special.reason, "override");
});
