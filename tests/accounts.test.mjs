import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
let dir, store, server, ownerCookie, staffCookie, staffId, orderId;
const base = "http://127.0.0.1:3419";
const ownerPassword = "fixture-owner-password-only";
const temporary = "fixture-temporary-password-only";
const personal = "fixture-personal-password-only";
async function request(path, method = "GET", data, cookie = ownerCookie) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "padrino-accounts-"));
  process.env.DATA_DIR = dir;
  store = await import("../store.mjs");
  store.setSetting("admin", store.hashPassword(ownerPassword));
  store.setSetting("shop", { ...store.defaults, enforceHours: false });
  store.db
    .prepare("INSERT INTO sessions(token,expires) VALUES(?,?)")
    .run("a".repeat(64), Date.now() + 60000);
  server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, DATA_DIR: dir, PORT: "3419", HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (data) => {
      if (String(data).includes("porta")) resolve();
    });
    server.stderr.on("data", (d) => process.stderr.write(d));
    server.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
  });
  const login = await request(
    "/api/admin/login",
    "POST",
    { username: "admin", password: ownerPassword },
    null,
  );
  assert.equal(login.status, 200);
  ownerCookie = login.cookie;
});
after(async () => {
  if (server?.exitCode === null) {
    server.kill();
    await new Promise((r) => server.once("exit", r));
  }
  store?.db.close();
  await rm(dir, { recursive: true, force: true });
});
test("migra senha antiga para proprietário e invalida sessões sem usuário", async () => {
  const session = await request("/api/admin/session");
  assert.equal(session.data.user.username, "admin");
  assert.equal(session.data.user.role, "owner");
  assert.equal(
    (
      await request(
        "/api/admin/session",
        "GET",
        null,
        "dp_session=" + "a".repeat(64),
      )
    ).data.authenticated,
    false,
  );
  const list = await request("/api/admin/users");
  assert.equal(list.data.length, 1);
  assert.ok(!JSON.stringify(list.data).includes("password_hash"));
  assert.equal(store.initializeAdmin("different-fixture-password"), false);
});
test("cria conta individual, exige troca de senha e revoga a senha temporária", async () => {
  const created = await request("/api/admin/users", "POST", {
    username: "atendente",
    name: "Ana Atendimento",
    password: temporary,
    permissions: { manageOrders: false, confirmPayments: false },
  });
  assert.equal(created.status, 201);
  staffId = created.data.id;
  assert.equal(created.data.mustChangePassword, true);
  const duplicate = await request("/api/admin/users", "POST", {
    username: "ATENDENTE",
    name: "Ana",
    password: temporary,
    permissions: { manageOrders: false, confirmPayments: false },
  });
  assert.equal(duplicate.status, 409);
  const login = await request(
    "/api/admin/login",
    "POST",
    { username: "atendente", password: temporary },
    null,
  );
  assert.equal(login.status, 200);
  staffCookie = login.cookie;
  assert.equal(
    (await request("/api/admin/orders", "GET", null, staffCookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/admin/password",
        "POST",
        { currentPassword: temporary, password: personal },
        staffCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/admin/orders", "GET", null, staffCookie)).status,
    401,
  );
  const logged = await request(
    "/api/admin/login",
    "POST",
    { username: "atendente", password: personal },
    null,
  );
  staffCookie = logged.cookie;
  assert.equal(logged.data.user.mustChangePassword, false);
});
test("consulta não autoriza configuração, equipe, pagamento, previsão nem etapas", async () => {
  const created = await request(
    "/api/orders",
    "POST",
    {
      requestKey: randomUUID(),
      items: [{ id: "calabresa", quantity: 1 }],
      fulfillment: "pickup",
      name: "Cliente Teste",
      phone: "21999999999",
      payment: "Pix",
    },
    null,
  );
  assert.equal(created.status, 201);
  orderId = created.data.id;
  const list = await request("/api/admin/orders", "GET", null, staffCookie);
  assert.equal(list.status, 200);
  assert.ok(!("courierToken" in list.data[0]));
  for (const path of [
    "/api/admin/settings",
    "/api/admin/users",
    "/api/admin/audit",
  ])
    assert.equal((await request(path, "GET", null, staffCookie)).status, 403);
  assert.equal(
    (await request("/api/admin/users", "POST", { role: "owner" }, staffCookie))
      .status,
    403,
  );
  for (const data of [
    { paid: true },
    { status: "cancelled" },
    { etaMinutes: 30 },
  ])
    assert.equal(
      (
        await request(
          `/api/admin/orders/${orderId}`,
          "PATCH",
          data,
          staffCookie,
        )
      ).status,
      403,
    );
  assert.equal(
    (await request(`/api/admin/users/1`, "PATCH", { enabled: false })).status,
    403,
  );
  assert.equal(
    (await request(`/api/admin/users/${staffId}`, "PATCH", { role: "owner" }))
      .status,
    400,
  );
});
test("permissões de pagamento e operação são independentes e bloqueio revoga acesso", async () => {
  assert.equal(
    (
      await request(`/api/admin/users/${staffId}`, "PATCH", {
        permissions: { manageOrders: true, confirmPayments: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/admin/orders", "GET", null, staffCookie)).status,
    401,
  );
  let login = await request(
    "/api/admin/login",
    "POST",
    { username: "atendente", password: personal },
    null,
  );
  staffCookie = login.cookie;
  assert.equal(
    (
      await request(
        `/api/admin/orders/${orderId}`,
        "PATCH",
        { paid: true },
        staffCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/admin/orders/${orderId}`,
        "PATCH",
        { etaMinutes: 30 },
        staffCookie,
      )
    ).status,
    200,
  );
  await request(`/api/admin/users/${staffId}`, "PATCH", {
    permissions: { manageOrders: false, confirmPayments: true },
  });
  login = await request(
    "/api/admin/login",
    "POST",
    { username: "atendente", password: personal },
    null,
  );
  assert.equal(login.status, 200);
  staffCookie = login.cookie;
  assert.equal(
    (
      await request(
        `/api/admin/orders/${orderId}`,
        "PATCH",
        { paid: true },
        staffCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/admin/orders/${orderId}`,
        "PATCH",
        { paid: false },
        staffCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/admin/orders/${orderId}`,
        "PATCH",
        { status: "preparing" },
        staffCookie,
      )
    ).status,
    403,
  );
  await request(`/api/admin/users/${staffId}`, "PATCH", {
    enabled: false,
    password: temporary,
  });
  assert.equal(
    (await request("/api/admin/orders", "GET", null, staffCookie)).status,
    401,
  );
  const log = await request("/api/admin/audit");
  assert.ok(
    log.data.some(
      (e) => e.username === "atendente" && e.action === "order.updated",
    ),
  );
  assert.ok(!JSON.stringify(log.data).includes(personal));
  assert.ok(!JSON.stringify(log.data).includes(temporary));
  // Owner's session is unaffected by staff changes.
  assert.equal((await request("/api/admin/session")).data.user.role, "owner");
});
