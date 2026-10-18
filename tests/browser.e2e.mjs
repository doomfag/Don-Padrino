import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
let dir, store, server, browser, adminCookie;
const base = "http://127.0.0.1:3418",
  password = "only-browser-fixture-password";
async function admin(path, method = "GET", data) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: data ? JSON.stringify(data) : undefined,
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "padrino-browser-"));
  process.env.DATA_DIR = dir;
  store = await import("../store.mjs");
  store.setSetting("admin", store.hashPassword(password));
  store.setSetting("shop", { ...store.defaults, enforceHours: false });
  server = spawn(
    process.execPath,
    ["--import", "./tests/postal-fixture.mjs", "server.mjs"],
    {
      env: { ...process.env, DATA_DIR: dir, PORT: "3418", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((r, j) => {
    server.stdout.on("data", (d) => {
      if (String(d).includes("porta")) r();
    });
    server.stderr.on("data", (d) => process.stderr.write(d));
    server.once("exit", (c) => j(new Error("Test server exited " + c)));
  });
  const login = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  adminCookie = login.headers.get("set-cookie").split(";")[0];
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  store?.db.close();
  await rm(dir, { force: true, recursive: true });
});
test("desktop: pedido completo, WhatsApp correto e acompanhamento SSE", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.locator(".hero h1")).toHaveText("Calabresa");
  await page.locator('.hero [data-product="calabresa"]').click();
  await page.locator("#product-note").fill("Sem cebola");
  await page.locator("#add-product").click();
  await page.locator('[data-add="guarana"]').click();
  await page.locator(".cart-trigger").click();
  await page.locator("#name").fill("Ana Teste");
  await page.locator("#phone").fill("21988887777");
  await expect(page.locator("#summary-total")).toHaveText(/57,00/);
  await page.locator("#submit-order").click();
  await expect(page.locator(".status-box h2")).toHaveText("Pedido registrado.");
  const link = page.locator("a.primary.green");
  const href = await link.getAttribute("href");
  assert.ok(href.startsWith("https://wa.me/5521994568096?text="));
  const text = new URL(href).searchParams.get("text");
  assert.match(text, /Sem cebola/);
  assert.match(text, /Guaraná Antarctica 2L/);
  assert.match(text, /57,00/);
  assert.match(text, /Ana Teste/);
  const orders = await admin("/api/admin/orders");
  const order = orders.find((o) => o.name === "Ana Teste");
  await admin(`/api/admin/orders/${order.id}`, "PATCH", {
    paid: true,
    status: "preparing",
    etaMinutes: 30,
  });
  await expect(page.locator(".status-box h2")).toHaveText(
    "Sua pizza está no forno.",
  );
  await expect(page.locator("#eta-display")).toContainText("30 min");
  await page.reload();
  await expect(page.locator(".status-box h2")).toHaveText(
    "Sua pizza está no forno.",
  );
  assert.deepEqual(errors, []);
  await page.close();
});
test("mobile: responsividade, endereço obrigatório, frete e GPS do entregador", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    permissions: ["geolocation"],
    geolocation: { latitude: -22.92, longitude: -43.71, accuracy: 15 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator(".hero").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator('[data-tab="menu"]').click();
  await page
    .locator('.pizza-card [data-product="frango-catupiry"]')
    .last()
    .click();
  await page.locator("#add-product").click();
  await page.locator('[data-add="coca"]').click();
  await page.locator('[data-tab="cart"]').click();
  await page.locator('[data-fulfillment="delivery"]').click();
  await page.locator("#postalCode").fill("23530-000");
  await expect(page.locator("#district")).toHaveValue("Sepetiba");
  await expect(page.locator("#summary-total")).toHaveText(/68,00/);
  await page.locator("#number").fill("15");
  await page.locator("#name").fill("Bruno Teste");
  await page.locator("#phone").fill("21988886666");
  assert.equal(
    await page.locator("#reference").evaluate((el) => el.required),
    true,
  );
  await page.locator("#reference").fill("Em frente à praça");
  await page.locator("#submit-order").click();
  await expect(page.locator(".status-box h2")).toHaveText("Pedido registrado.");
  const token = page.url().split("/").at(-1),
    orders = await admin("/api/admin/orders"),
    order = orders.find((o) => o.token === token);
  const href = await page.locator("a.primary.green").getAttribute("href");
  assert.match(new URL(href).searchParams.get("text"), /68,00/);
  assert.match(new URL(href).searchParams.get("text"), /Sepetiba/);
  await admin(`/api/admin/orders/${order.id}`, "PATCH", {
    paid: true,
    status: "preparing",
  });
  await admin(`/api/admin/orders/${order.id}`, "PATCH", { status: "ready" });
  await admin(`/api/admin/orders/${order.id}`, "PATCH", {
    status: "out_for_delivery",
  });
  await expect(page.locator(".status-box h2")).toHaveText(
    "A caminho da sua casa.",
  );
  const courier = await context.newPage();
  await courier.goto(base + `/entregador/${order.courierToken}`);
  await courier.locator("#gps-start").click();
  await expect(courier.locator("#gps-message")).toContainText(
    "Localização compartilhada",
  );
  await expect(page.locator(".tracking-map")).toHaveCount(1);
  await expect(page.locator("#gps-freshness")).toContainText("Último sinal");
  await courier.locator("#gps-stop").click();
  await expect(page.locator("#location-content")).toContainText(
    "ainda não compartilhou",
  );
  await admin(`/api/admin/orders/${order.id}`, "PATCH", {
    status: "delivered",
  });
  await expect(page.locator(".status-box h2")).toHaveText("Bom apetite!");
  assert.deepEqual(errors, []);
  await context.close();
});
test("admin: login, configurações, Instagram azul e ausência de overflow", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  await page.goto(base + "/admin");
  await page.locator("#admin-password").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator(".admin-top h1")).toHaveText(
    "À frente da cozinha.",
  );
  await expect(page.locator(".admin-order")).toHaveCount(1);
  await page.locator('[data-admin-tab="settings"]').click();
  await page.locator("#shop-notice").fill("Pedidos preparados com carinho.");
  await page.locator("#save-settings").click();
  await expect(page.locator("#toast")).toHaveText("Configurações salvas.");
  await page.goto(base + "/#informacoes");
  assert.ok(
    !(await page.locator("#informacoes").innerText()).includes("Sepetiba"),
  );
  assert.ok(
    !(await page.locator("#informacoes").innerText()).includes("Urucânia"),
  );
  const insta = page.locator("#informacoes .instagram");
  await expect(insta).toHaveAttribute(
    "href",
    "https://www.instagram.com/donpadrinorj/",
  );
  assert.equal(
    await insta.evaluate((el) => getComputedStyle(el).color),
    "rgb(120, 182, 255)",
  );
  for (const width of [320, 390, 540, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow em ${width}px`,
    );
  }
  await page.close();
});

test("fechamento com carrinho aberto bloqueia a compra e preserva os itens", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    timezoneId: "Asia/Tokyo",
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('.hero [data-product="calabresa"]').click();
  await page.locator("#add-product").click();
  await page.locator(".cart-trigger").click();
  await page.locator("#name").fill("Cliente no fechamento");
  await page.locator("#phone").fill("21988885555");
  await expect(page.locator("#submit-order")).toBeEnabled();
  await admin("/api/admin/settings", "PUT", { acceptingOrders: false });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator("#submit-order")).toBeDisabled();
  await expect(page.locator("#checkout-availability")).toContainText(
    "pausados",
  );
  await expect(page.locator("#name")).toHaveValue("Cliente no fechamento");
  await expect(page.locator("#cart-count")).toHaveText("1");
  await admin("/api/admin/settings", "PUT", { acceptingOrders: true });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator("#submit-order")).toBeEnabled();
  const before = await admin("/api/admin/orders");
  await page.route("**/api/orders", async (route) => {
    await admin("/api/admin/settings", "PUT", { acceptingOrders: false });
    await route.continue();
  });
  await page.locator("#submit-order").click();
  await expect(page.locator("#submit-order")).toBeDisabled();
  await expect(page.locator("#checkout-error")).toContainText("pausados");
  assert.equal((await admin("/api/admin/orders")).length, before.length);
  await expect(page.locator("#cart-count")).toHaveText("1");
  await admin("/api/admin/settings", "PUT", { acceptingOrders: true });
  await context.close();
});

test("prazo conhecido de fechamento bloqueia a finalização mesmo se a conexão cair", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await page.goto(base);
  await page.locator('.hero [data-product="calabresa"]').click();
  await page.locator("#add-product").click();
  await page.locator(".cart-trigger").click();
  await expect(page.locator("#submit-order")).toBeEnabled();
  let requests = 0;
  await page.route("**/api/availability", async (route) => {
    if (requests++) return route.abort("internetdisconnected");
    const now = Date.now();
    await route.fulfill({
      json: {
        open: true,
        reason: "open",
        serverNow: new Date(now).toISOString(),
        nextCloseAt: new Date(now + 300).toISOString(),
        nextOpenAt: null,
        shortLabel: "Aberto · pedidos até meia-noite",
        message: "Estamos abertos.",
      },
    });
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator("#submit-order")).toBeDisabled();
  await expect(page.locator("#checkout-availability")).toBeVisible();
  await expect(page.locator("#cart-count")).toHaveText("1");
  await page.close();
});
