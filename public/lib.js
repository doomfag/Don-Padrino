export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [
  ...root.querySelectorAll(selector),
];
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (cents) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const date = (value) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("O servidor não respondeu como esperado. Tente novamente.");
  }
  if (!res.ok)
    throw Object.assign(new Error(data.error || "Não foi possível concluir."), {
      status: res.status,
      ...(data.availability ? { availability: data.availability } : {}),
    });
  return data;
}
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3500);
}
export function navigate(path) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
let returnFocus = null,
  removeKeys = null;
export function closeOverlay() {
  const root = $("#overlay-root");
  root.replaceChildren();
  document.body.classList.remove("no-scroll");
  $(".menu-toggle")?.setAttribute("aria-expanded", "false");
  removeKeys?.();
  returnFocus?.focus?.();
}
export function overlay(content, kind = "drawer", label = "Seu pedido") {
  closeOverlay();
  returnFocus = document.activeElement;
  const root = $("#overlay-root");
  root.innerHTML =
    kind === "modal"
      ? `<div class="shade modal-shade" data-dismiss="true"><section class="product-modal" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${content}</section></div>`
      : `<div class="shade" data-dismiss="true"></div><section class="drawer ${kind === "menu" ? "menu-drawer" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${content}</section>`;
  document.body.classList.add("no-scroll");
  const dialog = $("[role=dialog]", root);
  dialog.focus();
  const listener = (e) => {
    if (e.key === "Escape") closeOverlay();
    if (e.key === "Tab") {
      const elements = $$(
        "button:not(:disabled),a[href],input:not(:disabled),select,textarea",
        dialog,
      ).filter((el) => el.offsetParent !== null);
      const first = elements[0],
        last = elements.at(-1);
      if (!elements.length) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", listener);
  removeKeys = () => document.removeEventListener("keydown", listener);
  root.onclick = (e) => {
    if (e.target.dataset.dismiss || e.target.closest("[data-close]"))
      closeOverlay();
  };
  return dialog;
}
export const statusLabels = {
  awaiting_payment: "Aguardando pagamento",
  preparing: "Em preparo",
  ready: "Pedido pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Concluído",
  cancelled: "Cancelado",
};
export function whatsappUrl(order, shop) {
  const lines = [
    `Olá, Don Padrino! Gostaria de confirmar o pedido ${order.number}:`,
    "",
    ...order.items.map(
      (i) =>
        `• ${i.quantity}x ${i.name}${i.type === "pizza" ? " (35 cm)" : ""} — ${money(i.price * i.quantity)}${i.note ? `\n  Observação: ${i.note}` : ""}`,
    ),
    "",
    `Tipo: ${order.fulfillment === "pickup" ? "Retirada no Portão" : "Entrega"}`,
    `Nome: ${order.name}`,
    `WhatsApp: ${order.phone}`,
  ];
  if (order.address)
    lines.push(
      `Endereço: ${order.address.street}, ${order.address.number} — ${order.address.district}, ${order.address.city}`,
      `CEP: ${order.address.postalCode}`,
      `Referência: ${order.address.reference}`,
    );
  else lines.push(`Retirada: ${shop.address}`);
  lines.push(
    `Pagamento: ${order.payment}${order.change ? ` (troco para ${money(order.change)})` : ""}`,
    `Subtotal: ${money(order.subtotal)}`,
    `Entrega: ${order.fee === 0 ? "Grátis / retirada" : money(order.fee)}`,
    `Total: ${money(order.total)}`,
    `Situação: ${order.paid ? "Pagamento recebido" : "Aguardando pagamento"}`,
    "",
    "Aguardo as instruções para pagamento.",
  );
  return `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`;
}
export function storeOrder(order) {
  try {
    let orders = JSON.parse(localStorage.getItem("dp-orders") || "[]");
    orders = orders.filter((o) => o.token !== order.token);
    orders.unshift({ token: order.token, number: order.number });
    localStorage.setItem("dp-orders", JSON.stringify(orders.slice(0, 10)));
  } catch {}
}
export function savedOrders() {
  try {
    return JSON.parse(localStorage.getItem("dp-orders") || "[]").filter((o) =>
      /^[a-f0-9]{48}$/.test(o.token),
    );
  } catch {
    return [];
  }
}
export function instagram(shop) {
  return `<a class="instagram" href="https://www.instagram.com/${esc(shop.instagram)}/" target="_blank" rel="noopener noreferrer">Instagram: @${esc(shop.instagram)} ↗</a>`;
}
