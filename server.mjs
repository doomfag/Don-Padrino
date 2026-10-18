import { postalLookup } from "./postal.mjs";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  db,
  catalog,
  settings,
  setSetting,
  getSetting,
  verifyPassword,
  orderView,
  quote,
  isOpen,
} from "./store.mjs";
const root = resolve("public");
const streams = new Map(),
  adminStreams = new Set(),
  attempts = new Map();
const secure = process.env.COOKIE_SECURE === "true";
const statuses = [
  "awaiting_payment",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
];
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function body(req) {
  let text = "";
  for await (const part of req) {
    text += part;
    if (text.length > 65536) fail("Requisição muito grande.", 413);
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Dados inválidos.");
  }
}
function auth(req) {
  const token = (req.headers.cookie || "").match(
    /(?:^|; )dp_session=([a-f0-9]{64})/,
  )?.[1];
  return token &&
    db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(token, Date.now())
    ? token
    : null;
}
function requireAuth(req) {
  if (!auth(req)) fail("Entre na sua conta para continuar.", 401);
}
function originCheck(req) {
  const origin = req.headers.origin;
  if (origin) {
    const expected =
      process.env.PUBLIC_ORIGIN ||
      `${secure ? "https" : "http"}://${req.headers.host}`;
    if (origin !== expected) fail("Origem não autorizada.", 403);
  }
}
function limit(req, key, max = 15) {
  const id = `${req.socket.remoteAddress}:${key}`,
    now = Date.now();
  let a = attempts.get(id);
  if (!a || a.until < now) {
    a = { count: 0, until: now + 60000 };
    attempts.set(id, a);
  }
  if (++a.count > max) fail("Muitas tentativas. Aguarde um minuto.", 429);
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
}
function notify(row) {
  const order = orderView(row);
  for (const res of streams.get(row.token) || [])
    res.write(`data: ${JSON.stringify(order)}\n\n`);
  for (const res of adminStreams) res.write('data: {"refresh":true}\n\n');
}
function subscribe(req, res, set, initial) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify(initial)}\n\n`);
  set.add(res);
  const timer = setInterval(() => {
    if (set === adminStreams && !auth(req)) {
      res.end();
      return;
    }
    res.write(": heartbeat\n\n");
  }, 20000);
  req.on("close", () => {
    clearInterval(timer);
    set.delete(res);
    if (!set.size)
      for (const [token, list] of streams)
        if (list === set) streams.delete(token);
  });
}
function safeText(v, max = 150) {
  return String(v || "")
    .trim()
    .slice(0, max);
}
function publicSettings() {
  const shop = settings();
  return Object.fromEntries(
    [
      "name",
      "cnpj",
      "whatsapp",
      "address",
      "postalCode",
      "hours",
      "instagram",
      "drinksConfirmed",
      "notice",
    ].map((key) => [key, shop[key]]),
  );
}
function validateShop(input) {
  const out = { ...settings() };
  if ("prepMinutes" in input) {
    if (
      !Number.isInteger(input.prepMinutes) ||
      input.prepMinutes < 5 ||
      input.prepMinutes > 180
    )
      fail("Informe o tempo de preparo entre 5 e 180 minutos.");
    out.prepMinutes = input.prepMinutes;
  }
  for (const key of ["address", "postalCode", "hours", "notice"])
    if (key in input)
      out[key] = safeText(input[key], key === "notice" ? 500 : 250);
  for (const key of ["drinksConfirmed", "acceptingOrders", "enforceHours"])
    if (typeof input[key] === "boolean") out[key] = input[key];
  if ("deliveryRates" in input) {
    if (!Array.isArray(input.deliveryRates) || input.deliveryRates.length !== 3)
      fail("Configure as três regiões atendidas.");
    out.deliveryRates = out.deliveryRates.map((r, i) => {
      const fee = input.deliveryRates[i].fee;
      if (!Number.isInteger(fee) || fee < 0 || fee > 100000)
        fail("Taxa de entrega inválida.");
      const minutes = input.deliveryRates[i].minutes ?? r.minutes;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120)
        fail("Prazo de entrega inválido.");
      return { ...r, fee, minutes };
    });
  }
  if ("deliveryRules" in input) {
    if (!Array.isArray(input.deliveryRules) || input.deliveryRules.length > 100)
      fail("Tabela de frete inválida.");
    out.deliveryRules = input.deliveryRules
      .map((r) => {
        const start = String(r.start).replace(/\D/g, ""),
          end = String(r.end).replace(/\D/g, "");
        if (
          !/^\d{8}$/.test(start) ||
          !/^\d{8}$/.test(end) ||
          start > end ||
          !Number.isInteger(r.fee) ||
          r.fee < 0 ||
          r.fee > 100000 ||
          !safeText(r.name)
        )
          fail("Confira o nome, a faixa de CEP e o valor de cada região.");
        return { name: safeText(r.name), start, end, fee: r.fee };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < out.deliveryRules.length; i++)
      if (out.deliveryRules[i].start <= out.deliveryRules[i - 1].end)
        fail("As faixas de CEP não podem se sobrepor.");
  }
  return out;
}
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://viacep.com.br; frame-src https://www.openstreetmap.org; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname,
      method = req.method;
    if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) originCheck(req);
    if (path === "/api/health") return json(res, 200, { ok: true });
    if (path === "/api/menu" && method === "GET")
      return json(res, 200, {
        products: catalog,
        shop: publicSettings(),
        open: isOpen(),
      });
    const postalMatch = path.match(/^\/api\/postal\/(\d{8})$/);
    if (postalMatch && method === "GET") {
      limit(req, "postal", 30);
      return json(res, 200, await postalLookup(postalMatch[1]));
    }
    if (path === "/api/quote" && method === "POST") {
      limit(req, "quote", 60);
      return json(res, 200, await quote(await body(req)));
    }
    if (path === "/api/orders" && method === "POST") {
      limit(req, "orders", 10);
      const input = await body(req);
      const key = safeText(input.requestKey, 80);
      if (!/^[a-f0-9-]{16,80}$/i.test(key))
        fail("Identificador do pedido inválido.");
      const old = db
        .prepare("SELECT * FROM orders WHERE request_key=?")
        .get(key);
      if (old) return json(res, 200, orderView(old));
      if (!isOpen())
        fail(
          "Estamos fechados agora. Funcionamos de quinta a domingo, das 18h às 00h.",
        );
      const q = await quote(input),
        name = safeText(input.name, 80),
        phone = String(input.phone || "").replace(/\D/g, "");
      if (name.length < 2 || !/^\d{10,11}$/.test(phone))
        fail("Informe seu nome e um WhatsApp válido.");
      if (!["Pix", "Cartão", "Dinheiro"].includes(input.payment))
        fail("Escolha a forma de pagamento.");
      const verifiedAddress =
        input.fulfillment === "delivery"
          ? await postalLookup(input.postalCode)
          : null;
      const address =
        input.fulfillment === "delivery"
          ? {
              street: safeText(verifiedAddress.street || input.street),
              number: safeText(input.number, 20),
              reference: safeText(input.reference),
              district: safeText(verifiedAddress.district || input.district),
              city: safeText(verifiedAddress.city),
              postalCode: String(input.postalCode).replace(/\D/g, ""),
            }
          : null;
      if (
        address &&
        (!address.street ||
          !address.number ||
          !address.reference ||
          !address.district)
      )
        fail("Preencha rua, número, bairro e ponto de referência.");
      const change =
        input.payment === "Dinheiro" && input.change
          ? Number(input.change)
          : null;
      if (
        change !== null &&
        (!Number.isInteger(change) || change < q.total || change > 1000000)
      )
        fail("O valor para troco deve cobrir o total.");
      const concurrent = db
        .prepare("SELECT * FROM orders WHERE request_key=?")
        .get(key);
      if (concurrent) return json(res, 200, orderView(concurrent));
      const token = randomBytes(24).toString("hex"),
        courier = randomBytes(24).toString("hex"),
        now = new Date().toISOString();
      const payload = {
        ...q,
        name,
        phone,
        fulfillment: input.fulfillment,
        payment: input.payment,
        change,
        address,
        paid: false,
        eta: null,
        location: null,
        history: [{ status: "awaiting_payment", at: now }],
      };
      const result = db
        .prepare(
          "INSERT INTO orders(token,courier,request_key,created_at,status,payload) VALUES(?,?,?,?,?,?)",
        )
        .run(
          token,
          courier,
          key,
          now,
          "awaiting_payment",
          JSON.stringify(payload),
        );
      const row = db
        .prepare("SELECT * FROM orders WHERE id=?")
        .get(result.lastInsertRowid);
      notify(row);
      return json(res, 201, orderView(row));
    }
    const orderMatch = path.match(/^\/api\/orders\/([a-f0-9]{48})(\/events)?$/);
    if (orderMatch && method === "GET") {
      const row = db
        .prepare("SELECT * FROM orders WHERE token=?")
        .get(orderMatch[1]);
      if (!row) fail("Pedido não encontrado.", 404);
      if (orderMatch[2]) {
        let set = streams.get(row.token);
        if (!set) {
          set = new Set();
          streams.set(row.token, set);
        }
        return subscribe(req, res, set, orderView(row));
      }
      return json(res, 200, orderView(row));
    }
    if (path === "/api/admin/session" && method === "GET")
      return json(res, 200, {
        authenticated: !!auth(req),
        configured: !!getSetting("admin"),
      });
    if (path === "/api/admin/login" && method === "POST") {
      limit(req, "login", 5);
      const { password } = await body(req);
      const hash = getSetting("admin");
      if (!hash)
        fail(
          "O acesso administrativo ainda precisa ser configurado pelo responsável pelo site.",
          503,
        );
      if (
        typeof password !== "string" ||
        password.length > 256 ||
        !verifyPassword(password, hash)
      )
        fail("Senha incorreta.", 401);
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        token,
        Date.now() + 12 * 3600000,
      );
      res.setHeader(
        "Set-Cookie",
        `dp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? "; Secure" : ""}`,
      );
      return json(res, 200, { ok: true });
    }
    if (path === "/api/admin/logout" && method === "POST") {
      const session = auth(req);
      if (session)
        db.prepare("DELETE FROM sessions WHERE token=?").run(session);
      res.setHeader(
        "Set-Cookie",
        `dp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
      );
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/api/admin/")) {
      requireAuth(req);
      if (path === "/api/admin/events" && method === "GET")
        return subscribe(req, res, adminStreams, { refresh: true });
      if (path === "/api/admin/orders" && method === "GET")
        return json(
          res,
          200,
          db
            .prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 300")
            .all()
            .map((r) => orderView(r, true)),
        );
      if (path === "/api/admin/settings" && method === "GET")
        return json(res, 200, settings());
      if (path === "/api/admin/settings" && method === "PUT") {
        const shop = validateShop(await body(req));
        setSetting("shop", shop);
        return json(res, 200, shop);
      }
      const match = path.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (match && method === "PATCH") {
        const input = await body(req);
        const row = db.prepare("SELECT * FROM orders WHERE id=?").get(match[1]);
        if (!row) fail("Pedido não encontrado.", 404);
        const payload = JSON.parse(row.payload);
        let status = row.status;
        if (typeof input.paid === "boolean") {
          if (["delivered", "cancelled"].includes(status))
            fail("Pedido encerrado.");
          if (input.paid === false && status !== "awaiting_payment")
            fail("O pagamento já foi confirmado e o preparo foi iniciado.");
          payload.paid = input.paid;
        }
        if (input.status) {
          if (!statuses.includes(input.status)) fail("Status inválido.");
          if (
            ["delivered", "cancelled"].includes(status) &&
            input.status !== status
          )
            fail("Pedido encerrado.");
          if (
            input.status !== "cancelled" &&
            statuses.indexOf(input.status) < statuses.indexOf(status)
          )
            fail("O pedido não pode voltar a uma etapa anterior.");
          if (
            ["preparing", "ready", "out_for_delivery", "delivered"].includes(
              input.status,
            ) &&
            !payload.paid
          )
            fail(
              "Confirme o recebimento do pagamento antes de iniciar o preparo.",
            );
          if (
            payload.fulfillment === "pickup" &&
            input.status === "out_for_delivery"
          )
            fail("Este pedido é para retirada.");
          if (status !== input.status) {
            const next = {
              awaiting_payment: "preparing",
              preparing: "ready",
              ready:
                payload.fulfillment === "pickup"
                  ? "delivered"
                  : "out_for_delivery",
              out_for_delivery: "delivered",
            };
            if (input.status !== "cancelled" && next[status] !== input.status)
              fail("Conclua a etapa atual antes de avançar o pedido.");
            status = input.status;
            if (status === "preparing")
              payload.eta = new Date(
                Date.now() +
                  (settings().prepMinutes + payload.deliveryMinutes) * 60000,
              ).toISOString();
            if (status === "out_for_delivery")
              payload.eta = new Date(
                Date.now() + payload.deliveryMinutes * 60000,
              ).toISOString();
            if (["delivered", "cancelled"].includes(status))
              payload.location = null;
            payload.history.push({ status, at: new Date().toISOString() });
          }
        }
        if ("etaMinutes" in input) {
          const minutes = Number(input.etaMinutes);
          if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240)
            fail("Prazo inválido.");
          payload.eta = minutes
            ? new Date(Date.now() + minutes * 60000).toISOString()
            : null;
        }
        db.prepare("UPDATE orders SET status=?,payload=? WHERE id=?").run(
          status,
          JSON.stringify(payload),
          row.id,
        );
        const updated = db
          .prepare("SELECT * FROM orders WHERE id=?")
          .get(row.id);
        notify(updated);
        return json(res, 200, orderView(updated, true));
      }
    }
    const courierMatch = path.match(/^\/api\/courier\/([a-f0-9]{48})$/);
    if (courierMatch) {
      const courierInput = method === "POST" ? await body(req) : null;
      const row = db
        .prepare("SELECT * FROM orders WHERE courier=?")
        .get(courierMatch[1]);
      if (!row) fail("Link de entrega inválido.", 404);
      const payload = JSON.parse(row.payload);
      if (payload.fulfillment !== "delivery")
        fail("Este pedido é para retirada.");
      if (method === "GET")
        return json(res, 200, {
          number: orderView(row).number,
          status: row.status,
          address: payload.address,
          location: payload.location,
        });
      if (method === "DELETE") {
        payload.location = null;
        db.prepare("UPDATE orders SET payload=? WHERE id=?").run(
          JSON.stringify(payload),
          row.id,
        );
        notify(db.prepare("SELECT * FROM orders WHERE id=?").get(row.id));
        return json(res, 200, { ok: true });
      }
      if (method === "POST") {
        limit(req, "gps", 30);
        if (row.status !== "out_for_delivery")
          fail("A localização só pode ser compartilhada durante a entrega.");
        const { latitude, longitude, accuracy } = courierInput;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180 ||
          !Number.isFinite(accuracy) ||
          accuracy < 0 ||
          accuracy > 100000
        )
          fail("Localização inválida.");
        payload.location = {
          latitude,
          longitude,
          accuracy,
          at: new Date().toISOString(),
        };
        db.prepare("UPDATE orders SET payload=? WHERE id=?").run(
          JSON.stringify(payload),
          row.id,
        );
        notify(db.prepare("SELECT * FROM orders WHERE id=?").get(row.id));
        return json(res, 200, { ok: true });
      }
    }
    if (path.startsWith("/api/"))
      return json(res, 404, { error: "Não encontrado." });
    if (!["GET", "HEAD"].includes(method)) fail("Método não permitido.", 405);
    const file = resolve(root, "." + decodeURIComponent(path));
    if (!file.startsWith(root + "/") && file !== root)
      fail("Não encontrado.", 404);
    let target = file;
    try {
      if (!(await stat(target)).isFile()) target = resolve(root, "index.html");
    } catch {
      if (extname(path)) fail("Arquivo não encontrado.", 404);
      target = resolve(root, "index.html");
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control":
        extname(target) === ".webp" ? "public,max-age=86400" : "no-cache",
    });
    res.end(method === "HEAD" ? undefined : await readFile(target));
  } catch (error) {
    if (error.code) error.status = 500;
    if (!res.headersSent)
      json(res, error.status || 400, {
        error:
          error.status === 500
            ? "Erro interno. Tente novamente."
            : error.message,
      });
    else res.end();
  }
});
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () => console.log(`Don Padrino · porta ${process.env.PORT || 3000}`),
);
function shutdown() {
  for (const set of streams.values()) for (const res of set) res.end();
  for (const res of adminStreams) res.end();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
