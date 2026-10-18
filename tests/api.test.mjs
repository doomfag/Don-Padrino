import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
let dir,
  child,
  cookie,
  store,
  base = "http://127.0.0.1:3417";
const testPassword = "fixture-only-test-password-43";
async function request(path, method = "GET", data, admin = false) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(admin ? { Cookie: cookie } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}
async function start() {
  child = spawn(
    process.execPath,
    ["--import", "./tests/postal-fixture.mjs", "server.mjs"],
    {
      env: { ...process.env, DATA_DIR: dir, PORT: "3417", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      if (String(d).includes("porta")) resolve();
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.once("exit", (code) =>
      reject(new Error("Test server exited " + code)),
    );
  });
}
async function stop() {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}
const input = (extra = {}) => ({
  requestKey: randomUUID(),
  items: [{ id: "frango-catupiry", quantity: 1, note: "Sem azeitonas" }],
  fulfillment: "pickup",
  name: "Cliente Teste",
  phone: "21999999999",
  payment: "Pix",
  ...extra,
});
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "padrino-test-"));
  process.env.DATA_DIR = dir;
  store = await import("../store.mjs");
  store.setSetting("admin", store.hashPassword(testPassword));
  store.setSetting("shop", { ...store.defaults, enforceHours: false });
  await start();
  const r = await request("/api/admin/login", "POST", {
    password: testPassword,
  });
  cookie = r.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  await stop();
  store.db.close();
  await rm(dir, { recursive: true, force: true });
});
test("catálogo, identidade e API administrativa protegida", async () => {
  const r = await request("/api/menu");
  assert.equal(r.status, 200);
  assert.equal(r.data.products.length, 9);
  assert.equal(r.data.shop.instagram, "donpadrinorj");
  assert.equal(r.data.shop.cnpj, "68.686.833/0001-91");
  assert.equal((await request("/api/admin/orders")).status, 401);
  assert.ok(!("deliveryRates" in r.data.shop));
  assert.ok(!("deliveryRules" in r.data.shop));
  assert.equal((await request("/api/admin/settings")).status, 401);
  const privateSettings = await request(
    "/api/admin/settings",
    "GET",
    null,
    true,
  );
  assert.equal(privateSettings.data.deliveryRates.length, 3);
  assert.equal(
    (await request("/api/admin/login", "POST", { password: "errada" })).status,
    401,
  );
});
test("cálculo autoritativo, bebidas, taxas e CEP fora da área", async () => {
  const r = await request(
    "/api/quote",
    "POST",
    input({
      items: [
        { id: "frango-catupiry", quantity: 1, price: 1 },
        { id: "guarana", quantity: 1 },
      ],
    }),
  );
  assert.equal(r.data.total, 5700);
  const delivery = await request(
    "/api/quote",
    "POST",
    input({ fulfillment: "delivery", postalCode: "23550-170" }),
  );
  assert.equal(delivery.data.fee, 600);
  assert.equal(delivery.data.total, 5100);
  assert.equal(
    (
      await request(
        "/api/quote",
        "POST",
        input({ fulfillment: "delivery", postalCode: "23530000" }),
      )
    ).data.fee,
    900,
  );
  assert.equal(
    (
      await request(
        "/api/quote",
        "POST",
        input({ fulfillment: "delivery", postalCode: "23575000" }),
      )
    ).data.fee,
    700,
  );
  assert.equal(
    (
      await request(
        "/api/quote",
        "POST",
        input({ fulfillment: "delivery", postalCode: "01001000" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/quote",
        "POST",
        input({ items: [{ id: "calabresa", quantity: -1 }] }),
      )
    ).status,
    400,
  );
});
test("pedido sem cadastro é persistido, idempotente e não aceita endereço incompleto", async () => {
  const data = input();
  const r = await request("/api/orders", "POST", data);
  assert.equal(r.status, 201);
  assert.equal(r.data.status, "awaiting_payment");
  assert.equal(r.data.paid, false);
  assert.ok(!("courierToken" in r.data));
  const duplicate = await request("/api/orders", "POST", data);
  assert.equal(duplicate.data.id, r.data.id);
  assert.equal((await request(`/api/orders/${r.data.token}`)).data.total, 4500);
  assert.equal(
    (
      await request(
        "/api/orders",
        "POST",
        input({
          fulfillment: "delivery",
          postalCode: "23550170",
          street: "Rua",
          number: "8",
          district: "Santa Cruz",
        }),
      )
    ).status,
    400,
  );
  await stop();
  await start();
  assert.equal(
    (await request(`/api/orders/${r.data.token}`)).data.number,
    r.data.number,
  );
});
test("pagamento, atualizações SSE, GPS real e encerramento da entrega", async () => {
  const r = await request(
    "/api/orders",
    "POST",
    input({
      fulfillment: "delivery",
      postalCode: "23550170",
      street: "Outra rua",
      number: "8",
      reference: "Portão verde",
      district: "Santa Cruz",
      city: "Rio de Janeiro",
    }),
  );
  assert.equal(r.status, 201);
  assert.equal(r.data.address.street, "Travessa Projetada C");
  const id = r.data.id;
  assert.equal(
    (
      await request(
        `/api/admin/orders/${id}`,
        "PATCH",
        { status: "preparing" },
        true,
      )
    ).status,
    400,
  );
  const ctl = new AbortController();
  const response = await fetch(`${base}/api/orders/${r.data.token}/events`, {
    signal: ctl.signal,
  });
  const reader = response.body.getReader();
  let chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /awaiting_payment/);
  await request(
    `/api/admin/orders/${id}`,
    "PATCH",
    { paid: true, status: "preparing", etaMinutes: 40 },
    true,
  );
  chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /preparing/);
  ctl.abort();
  await request(`/api/admin/orders/${id}`, "PATCH", { status: "ready" }, true);
  await request(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "out_for_delivery" },
    true,
  );
  const all = await request("/api/admin/orders", "GET", null, true);
  const order = all.data.find((o) => o.id === id);
  assert.match(order.courierToken, /^[a-f0-9]{48}$/);
  assert.equal(
    (
      await request(`/api/courier/${order.courierToken}`, "POST", {
        latitude: -22.9,
        longitude: -43.7,
        accuracy: 12,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/orders/${r.data.token}`)).data.location.latitude,
    -22.9,
  );
  await request(`/api/courier/${order.courierToken}`, "DELETE");
  assert.equal(
    (await request(`/api/orders/${r.data.token}`)).data.location,
    null,
  );
  await request(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "delivered" },
    true,
  );
  assert.equal(
    (
      await request(`/api/courier/${order.courierToken}`, "POST", {
        latitude: -22.9,
        longitude: -43.7,
        accuracy: 12,
      })
    ).status,
    400,
  );
});
test("configurações validam faixas, pausam venda e preservam pedidos anteriores", async () => {
  assert.equal(
    (
      await request(
        "/api/admin/settings",
        "PUT",
        {
          deliveryRules: [
            { name: "A", start: "23550000", end: "23550999", fee: 600 },
            { name: "B", start: "23550100", end: "23550200", fee: 900 },
          ],
        },
        true,
      )
    ).status,
    400,
  );
  await request("/api/admin/settings", "PUT", { acceptingOrders: false }, true);
  assert.equal((await request("/api/orders", "POST", input())).status, 400);
  await request(
    "/api/admin/settings",
    "PUT",
    { acceptingOrders: true, drinksConfirmed: false },
    true,
  );
  assert.equal(
    (
      await request(
        "/api/quote",
        "POST",
        input({ items: [{ id: "guarana", quantity: 1 }] }),
      )
    ).status,
    400,
  );
  const cross = await fetch(base + "/api/admin/settings", {
    method: "PUT",
    headers: {
      Origin: "https://hostile.example",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: "{}",
  });
  assert.equal(cross.status, 403);
});
test("horários usam Brasília e fecham à meia-noite", () => {
  const shop = { ...store.defaults };
  assert.equal(store.isOpen(shop, new Date("2026-10-18T22:00:00Z")), true);
  assert.equal(store.isOpen(shop, new Date("2026-10-19T03:00:00Z")), false);
  assert.equal(store.isOpen(shop, new Date("2026-10-20T22:00:00Z")), false);
});

// A simultaneous retry must return the same persisted order, including when postal lookup yields.
test("envios simultâneos da mesma tentativa não duplicam pedidos", async () => {
  await request(
    "/api/admin/settings",
    "PUT",
    { acceptingOrders: true, enforceHours: false },
    true,
  );
  const data = input({
    fulfillment: "delivery",
    postalCode: "23550170",
    street: "Travessa Projetada C",
    number: "8",
    reference: "Portão verde",
    district: "Santa Cruz",
  });
  const [a, b] = await Promise.all([
    request("/api/orders", "POST", data),
    request("/api/orders", "POST", data),
  ]);
  assert.ok([200, 201].includes(a.status));
  assert.ok([200, 201].includes(b.status));
  assert.equal(a.data.id, b.data.id);
});
