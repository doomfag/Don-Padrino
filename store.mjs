import { getAvailability } from "./hours.mjs";
import { postalLookup, normalized } from "./postal.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export const dataDir = resolve(process.env.DATA_DIR || "./data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, "padrino.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, courier TEXT UNIQUE NOT NULL, request_key TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
`);
export const catalog = [
  [
    "calabresa",
    "Calabresa",
    "Calabresa, muçarela, cebola, azeitonas pretas e orégano.",
  ],
  ["mucarela", "Muçarela", "Muçarela, tomate, azeitonas pretas e orégano."],
  [
    "frango-catupiry",
    "Frango com Catupiry",
    "Frango desfiado, muçarela, Catupiry, azeitonas pretas e orégano.",
  ],
  [
    "margherita",
    "Margherita",
    "Muçarela, tomate, manjericão, azeitonas pretas e orégano.",
  ],
  [
    "portuguesa",
    "Portuguesa",
    "Presunto, muçarela, ovo, cebola, azeitonas e orégano.",
  ],
  ["mista", "Mista", "Presunto, muçarela, tomate, azeitonas pretas e orégano."],
  [
    "frango-bacon",
    "Frango com Bacon",
    "Frango, Catupiry, bacon, muçarela, azeitonas e orégano.",
  ],
].map(([id, name, description]) => ({
  id,
  name,
  description,
  price: 4500,
  type: "pizza",
  image: `/assets/${id}-hd.webp`,
  thumbnail: `/assets/${id}-card.webp`,
}));
catalog.push(
  {
    id: "guarana",
    name: "Guaraná Antarctica 2L",
    description: "Para acompanhar sua pizza.",
    price: 1200,
    type: "drink",
    image: "/assets/refrigerantes-2l-v2.webp",
    imageColumn: 0,
  },
  {
    id: "coca",
    name: "Coca-Cola 2L",
    description: "Para acompanhar sua pizza.",
    price: 1400,
    type: "drink",
    image: "/assets/refrigerantes-2l-v2.webp",
    imageColumn: 1,
  },
  {
    id: "coca-zero",
    name: "Coca-Cola Zero Açúcar 2L",
    description: "Todo o sabor, sem açúcar.",
    price: 1500,
    type: "drink",
    image: "/assets/refrigerantes-2l-v2.webp",
    imageColumn: 2,
  },
  {
    id: "fanta-laranja",
    name: "Fanta Laranja 2L",
    description: "Para acompanhar sua pizza.",
    price: 1200,
    type: "drink",
    image: "/assets/refrigerantes-2l-v2.webp",
    imageColumn: 3,
  },
);
export const defaults = {
  name: "Don Padrino",
  cnpj: "68.686.833/0001-91",
  whatsapp: "5521994568096",
  address:
    "Travessa Projetada C, nº 8 — Dumas, Santa Cruz, Rio de Janeiro — RJ",
  postalCode: "23550-170",
  hours: "Quinta a domingo, das 18h às 00h.",
  instagram: "donpadrinorj",
  deliveryRules: [],
  deliveryRates: [
    {
      name: "Santa Cruz",
      fee: 600,
      minutes: 15,
      aliases: ["santa cruz", "dumas"],
    },
    { name: "Urucânia", fee: 700, minutes: 18, aliases: ["urucania"] },
    { name: "Sepetiba", fee: 900, minutes: 25, aliases: ["sepetiba"] },
  ],
  drinksConfirmed: true,
  acceptingOrders: true,
  enforceHours: true,
  prepMinutes: 35,
  notice: "",
};
export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
export function settings() {
  return { ...defaults, ...getSetting("shop") };
}
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, hash) {
  try {
    const [salt, key] = hash.split(":");
    return timingSafeEqual(
      Buffer.from(key, "hex"),
      scryptSync(password, salt, 64),
    );
  } catch {
    return false;
  }
}
export function orderView(row, admin = false) {
  if (!row) return null;
  const p = JSON.parse(row.payload);
  return {
    ...p,
    id: row.id,
    number: `DP-${String(row.id).padStart(5, "0")}`,
    token: row.token,
    createdAt: row.created_at,
    status: row.status,
    ...(admin ? { courierToken: row.courier } : {}),
  };
}
export async function quote(input) {
  const shop = settings();
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 40
  )
    throw new Error("Adicione ao menos um item ao pedido.");
  const items = input.items.map((i) => {
    const product = catalog.find((p) => p.id === i.id);
    if (
      !product ||
      !Number.isInteger(i.quantity) ||
      i.quantity < 1 ||
      i.quantity > 30
    )
      throw new Error("Item ou quantidade inválida.");
    if (product.type === "drink" && !shop.drinksConfirmed)
      throw new Error(
        "Os preços das bebidas ainda não foram confirmados pela pizzaria.",
      );
    return {
      ...product,
      quantity: i.quantity,
      note: String(i.note || "").slice(0, 300),
    };
  });
  if (!["pickup", "delivery"].includes(input.fulfillment))
    throw new Error("Escolha entrega ou retirada.");
  let fee = 0,
    rule = null;
  if (input.fulfillment === "delivery") {
    const cep = String(input.postalCode || "").replace(/\D/g, "");
    if (cep.length !== 8)
      throw new Error("Informe um CEP válido com 8 números.");
    rule = shop.deliveryRules.find((r) => cep >= r.start && cep <= r.end);
    if (!rule) {
      const address = await postalLookup(cep);
      if (
        address.state !== "RJ" ||
        normalized(address.city) !== "rio de janeiro"
      )
        throw new Error(
          "Ainda não entregamos neste CEP. Consulte o atendimento pelo WhatsApp.",
        );
      rule = shop.deliveryRates.find((r) =>
        r.aliases.some((a) => normalized(a) === normalized(address.district)),
      );
      if (!rule)
        throw new Error(
          "Este CEP não está em nossa área de entrega automática. Consulte pelo WhatsApp.",
        );
    }
    fee = rule.fee;
  }
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    items,
    subtotal,
    fee,
    total: subtotal + fee,
    deliveryZone: rule?.name || null,
    deliveryMinutes: rule
      ? rule.minutes ||
        shop.deliveryRates.find(
          (r) => normalized(r.name) === normalized(rule.name),
        )?.minutes ||
        20
      : 0,
  };
}

export function isOpen(shop = settings(), date = new Date()) {
  return getAvailability(shop, date).open;
}
