import {
  $,
  $$,
  esc,
  money,
  api,
  toast,
  navigate,
  overlay,
  closeOverlay,
  savedOrders,
  storeOrder,
  instagram,
} from "./lib.js";
const main = $("#main");
let products = [],
  shop = {},
  open = false,
  availability = null,
  availabilityTimer,
  availabilityRequest = null,
  slide = 0,
  slideTimer,
  cleanupPage = () => {},
  homeObserver;
let cart = [];
try {
  cart = JSON.parse(localStorage.getItem("dp-cart") || "[]").filter(
    (i) =>
      i.id &&
      Number.isInteger(i.quantity) &&
      i.quantity > 0 &&
      i.quantity <= 30,
  );
} catch {}
let draft = {
    fulfillment: "pickup",
    name: "",
    phone: "",
    payment: "Pix",
    postalCode: "",
    street: "",
    number: "",
    reference: "",
    district: "",
    city: "",
    change: "",
  },
  quoteResult = null,
  quoteRevision = 0,
  requestKey = null,
  submitting = false;
const count = () => cart.reduce((s, i) => s + i.quantity, 0);
function updateAvailabilityUI() {
  const banner = $("#store-availability");
  banner.hidden = location.pathname !== "/";
  banner.classList.toggle("is-open", open);
  $("#availability-label").textContent =
    availability?.shortLabel || "Consultando atendimento…";
  $$("[data-store-status]").forEach((el) => {
    el.className = open ? "store-open" : "store-closed";
    el.textContent = `● ${availability?.shortLabel || "Consultando atendimento…"}`;
  });
  const notice = $("#checkout-availability");
  if (notice) {
    notice.hidden = open;
    notice.textContent =
      availability?.message ||
      "Não foi possível confirmar o atendimento. Verifique a conexão e tente novamente.";
  }
  const button = $("#submit-order");
  if (button) {
    button.disabled = submitting || !open || !quoteResult;
    if (!submitting)
      button.innerHTML = open
        ? 'FINALIZAR PEDIDO <span class="arrow">↗</span>'
        : "FECHADO NO MOMENTO";
  }
}
function applyAvailability(state) {
  availability = state;
  open = state.open;
  clearTimeout(availabilityTimer);
  const transition = state.open ? state.nextCloseAt : state.nextOpenAt;
  if (transition) {
    const delay = new Date(transition) - new Date(state.serverNow);
    if (delay > 0)
      availabilityTimer = setTimeout(
        () => {
          // Close immediately when the known deadline arrives, even if the connection drops.
          if (open)
            markAvailabilityUnknown("Fechado · verificando próxima abertura…");
          refreshAvailability().catch(markAvailabilityUnknown);
        },
        Math.min(delay + 50, 2147483647),
      );
  }
  updateAvailabilityUI();
}
function markAvailabilityUnknown(label) {
  open = false;
  availability = {
    open: false,
    shortLabel:
      typeof label === "string"
        ? label
        : "Verifique sua conexão para confirmar o atendimento",
    message:
      typeof label === "string"
        ? "Estamos fechados agora. Recebemos pedidos de quinta a domingo, das 18h à meia-noite. Seu carrinho continua salvo."
        : "Não foi possível confirmar o atendimento. Reconecte para verificar o horário de abertura.",
  };
  updateAvailabilityUI();
}
async function refreshAvailability() {
  if (!availabilityRequest)
    availabilityRequest = api("/api/availability", {
      signal: AbortSignal.timeout(10000),
    })
      .then((state) => {
        applyAvailability(state);
        return state;
      })
      .finally(() => {
        availabilityRequest = null;
      });
  return availabilityRequest;
}
function saveCart() {
  try {
    localStorage.setItem("dp-cart", JSON.stringify(cart));
  } catch {}
  requestKey = null;
  updateCartBadge();
}
function updateCartBadge() {
  $("#cart-count").textContent = count();
  $("#mobile-cart-count").textContent = count() ? `· ${count()}` : "";
  $(".cart-trigger").setAttribute("aria-label", `Meu pedido, ${count()} itens`);
}
function addItem(id, quantity = 1, note = "") {
  const existing = cart.find((i) => i.id === id && i.note === note);
  if (existing) {
    if (existing.quantity + quantity > 30) {
      toast("O limite é de 30 unidades por item.");
      return;
    }
    existing.quantity += quantity;
  } else cart.push({ id, quantity, note });
  saveCart();
  toast("Adicionado ao seu pedido.");
}
function image(product, cls = "", loading = "lazy") {
  if (product.type === "drink")
    return `<span class="drink-photo ${cls}" role="img" aria-label="${esc(product.name)}"><img class="drink-bottle" src="${esc(cls === "product-picture" ? product.image : product.thumbnail || product.image)}" alt="" width="640" height="960" loading="${loading}" decoding="async"></span>`;
  const compact = cls === "card-image" || !cls;
  return `<img class="${cls}" src="${esc(compact ? product.thumbnail || product.image : product.image)}" alt="Pizza ${esc(product.name)}" loading="${loading}" decoding="async" ${cls === "hero-image" ? 'fetchpriority="high"' : ""} width="${compact ? 640 : 1254}" height="${compact ? 640 : 1254}">`;
}
function setTab(name) {
  $$("[data-tab]").forEach((el) =>
    el.classList.toggle("active", el.dataset.tab === name),
  );
}
function heroMarkup() {
  const p = products.filter((p) => p.type === "pizza")[slide];
  return `<section class="hero ${p.id === "margherita" ? "green" : ""}" aria-label="Pizzas em destaque"><div class="specks"></div><span class="leaf one"></span><span class="leaf two"></span><span class="leaf three"></span><div class="hero-main"><div class="hero-heading"><p class="eyebrow">DON PADRINO / PIZZAS</p><h1>${esc(p.name)}</h1><button class="outline" data-product="${p.id}">VER ESTA PIZZA <span class="arrow">↗</span></button></div><div class="hero-image-wrap"><div class="hero-float"><div class="hero-rotation">${image(p, "hero-image", "eager")}</div></div></div><div class="hero-details"><div class="hero-number"><strong>${String(slide + 1).padStart(2, "0")}</strong><span>/ 07</span></div><i class="hero-rule"></i><h2>${esc(p.name)}</h2><p class="hero-description">${esc(p.description)}</p><div class="size">35 cm &nbsp; / &nbsp; 8 fatias</div><div class="price">${money(p.price)}</div></div><div class="hero-controls"><div class="dots" aria-label="Escolher pizza em destaque">${products
    .filter((p) => p.type === "pizza")
    .map(
      (p, i) =>
        `<button class="${i === slide ? "active" : ""}" data-slide="${i}" aria-label="Mostrar ${esc(p.name)}" aria-pressed="${i === slide}"></button>`,
    )
    .join(
      "",
    )}</div><a href="#cardapio" class="explore">EXPLORAR CARDÁPIO &nbsp; ↓</a><div class="hero-arrows"><button data-slide-step="-1" aria-label="Pizza anterior">←</button><button data-slide-step="1" aria-label="Próxima pizza">→</button></div></div></div></section>`;
}
let slideRequest = 0;
const readyImages = new Map();
function prepareImage(product) {
  if (!readyImages.has(product.id)) {
    const img = new Image();
    img.src = product.image;
    readyImages.set(
      product.id,
      img.decode().catch(() => {}),
    );
  }
  return readyImages.get(product.id);
}
async function setSlide(index) {
  const request = ++slideRequest;
  const next = (index + 7) % 7;
  const pizzas = products.filter((p) => p.type === "pizza");
  await prepareImage(pizzas[next]);
  if (request !== slideRequest || !$(".hero")) return;
  slide = next;
  $(".hero").outerHTML = heroMarkup();
  prepareImage(pizzas[(slide + 1) % 7]);
}
function renderHome() {
  main.innerHTML = `${shop.notice ? `<div class="site-notice">${esc(shop.notice)}</div>` : ""}<div id="inicio">${heroMarkup()}</div><section class="section" id="cardapio"><div class="section-header"><div><p class="eyebrow">01 / CARDÁPIO</p><h2>Escolha sua pizza.</h2></div><div class="section-meta">35 cm · 8 fatias<br><small>Todos os sabores: ${money(4500)}</small></div></div><div class="pizza-grid">${products
    .filter((p) => p.type === "pizza")
    .map(
      (p) =>
        `<article class="pizza-card"><button data-product="${p.id}" class="image-button" aria-label="Ver pizza ${esc(p.name)}">${image(p, "card-image")}</button><button class="card-title" data-product="${p.id}">${esc(p.name)}</button><p class="card-description">${esc(p.description)}</p><p class="card-size">35 cm · 8 fatias</p><div class="card-bottom"><span class="currency">${money(p.price)}</span><button class="add-button" data-product="${p.id}" aria-label="Adicionar ${esc(p.name)}">+</button></div></article>`,
    )
    .join(
      "",
    )}<article class="drinks-card"><p class="eyebrow">PARA ACOMPANHAR</p><h3>Refrigerantes<br>2 litros.</h3>${products
    .filter((p) => p.type === "drink")
    .map(
      (p) =>
        `<div class="drink-row"><button class="drink-preview" data-product="${p.id}" aria-label="Ver foto e detalhes de ${esc(p.name)}">${image(p, "drink-thumb")}</button><div><button class="drink-name" data-product="${p.id}">${esc(p.name)}</button><strong>${money(p.price)}</strong></div><button class="add-button" data-add="${p.id}" aria-label="Adicionar ${esc(p.name)}" ${shop.drinksConfirmed ? "" : "disabled"}>+</button></div>`,
    )
    .join(
      "",
    )}${!shop.drinksConfirmed ? '<p class="hint">Disponibilidade e preços em confirmação.</p>' : ""}<button class="outline" data-action="cart">VER MEU PEDIDO <span class="arrow">↗</span></button></article></div></section><section id="informacoes" class="section info-section"><div class="info-inner"><p class="eyebrow">02 / INFORMAÇÕES</p><h2>Entrega ou retirada.</h2><div class="info-grid"><div><p>${esc(shop.address)}<br>CEP ${esc(shop.postalCode)}</p><p>Consulte a disponibilidade pelo CEP.<br>A taxa aparece no pedido antes de finalizar.</p><span data-store-status class="${open ? "store-open" : "store-closed"}">● ${esc(availability?.shortLabel || "Consultando horário…")}</span></div><div><p>${esc(shop.hours)}<br>Horário de Brasília.</p><p><a href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp (21) 99456-8096 ↗</a></p><p>${instagram(shop)}</p></div></div><div class="accepted-payments" aria-labelledby="accepted-payments-title"><h3 id="accepted-payments-title">Aceitamos</h3><ul class="payment-method-list"><li><img src="/assets/payment-cash.svg" width="24" height="24" alt="" loading="lazy">Dinheiro</li><li><img class="pix-mark" src="/assets/payment-pix.svg" width="24" height="24" alt="" loading="lazy">Pix</li><li><img src="/assets/payment-card.svg" width="24" height="24" alt="" loading="lazy">Cartão</li></ul></div><div class="info-cnpj"><span>CNPJ ${esc(shop.cnpj)}</span><div><a href="/privacidade">Privacidade</a></div></div></div></section>`;
  prepareImage(products.filter((p) => p.type === "pizza")[(slide + 1) % 7]);
  // Autoplay stays active while hovering; only hidden pages and open dialogs pause it.
  slideTimer = setInterval(() => {
    if (
      !document.hidden &&
      !$("#overlay-root").children.length &&
      window.scrollY < window.innerHeight * 0.6 &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      setSlide(slide + 1);
  }, 7500);
  homeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting)
          setTab(entry.target.id === "inicio" ? "home" : "menu");
    },
    { rootMargin: "-15% 0px -55% 0px" },
  );
  homeObserver.observe($("#inicio"));
  homeObserver.observe($("#cardapio"));
  cleanupPage = () => {
    slideRequest++;
    clearInterval(slideTimer);
    homeObserver.disconnect();
  };
  setTab(location.hash === "#cardapio" ? "menu" : "home");
  if (location.hash)
    setTimeout(
      () => $(location.hash)?.scrollIntoView({ behavior: "instant" }),
      50,
    );
}
function openProduct(id) {
  const p = products.find((p) => p.id === id);
  if (!p) return;
  let qty = 1;
  const isDrink = p.type === "drink";
  const dialog = overlay(
    `<div class="modal-top"><button data-close>‹ &nbsp; Cardápio</button><button class="icon-button close-button" data-close aria-label="Fechar detalhes">×</button></div><div class="product-layout ${isDrink ? "drink-product-layout" : ""}">${image(p, "product-picture", "eager")}<div class="product-content"><h2>${esc(p.name)}</h2><p class="size">${isDrink ? "Garrafa de 2 litros" : "35 cm / 8 fatias"}</p><p>${isDrink ? esc(p.description) : `Molho de tomate, ${esc(p.description.charAt(0).toLowerCase() + p.description.slice(1))}`}</p><div class="product-price-row"><strong class="price" id="product-total">${money(p.price)}</strong><div class="quantity"><button data-product-qty="-1" aria-label="Diminuir quantidade">−</button><span id="product-qty">1</span><button data-product-qty="1" aria-label="Aumentar quantidade">+</button></div></div><div class="field"><label for="product-note">Observações (opcional)</label><input id="product-note" maxlength="300" placeholder="${isDrink ? "Alguma observação sobre a bebida?" : "Alguma observação sobre sua pizza?"}"></div><button class="primary" id="add-product" ${isDrink && !shop.drinksConfirmed ? "disabled" : ""}>ADICIONAR AO PEDIDO <span class="arrow">↗</span></button></div></div>`,
    "modal",
    p.name,
  );
  $$("[data-product-qty]", dialog).forEach(
    (b) =>
      (b.onclick = () => {
        qty = Math.max(1, Math.min(30, qty + Number(b.dataset.productQty)));
        $("#product-qty").textContent = qty;
        $("#product-total").textContent = money(p.price * qty);
      }),
  );
  $("#add-product").onclick = () => {
    addItem(p.id, qty, $("#product-note").value.trim());
    closeOverlay();
  };
}
function cartItemsHtml() {
  return cart
    .map((item, index) => {
      const p = products.find((p) => p.id === item.id);
      if (!p) return "";
      return `<div class="cart-line">${image(p)}<div><h3>${esc(p.name)}</h3><p>${item.note ? esc(item.note) + "<br>" : ""}${money(p.price * item.quantity)}</p><div class="quantity"><button data-cart-qty="${index}" data-step="-1" aria-label="Diminuir ${esc(p.name)}">−</button><span>${item.quantity}</span><button data-cart-qty="${index}" data-step="1" aria-label="Aumentar ${esc(p.name)}">+</button></div></div><button class="remove" data-remove="${index}" aria-label="Remover ${esc(p.name)}">×</button></div>`;
    })
    .join("");
}
function cartSubtotal() {
  return cart.reduce(
    (sum, i) =>
      sum + (products.find((p) => p.id === i.id)?.price || 0) * i.quantity,
    0,
  );
}
function deliveryFields() {
  return `<div class="field"><label for="postalCode">CEP *</label><input id="postalCode" name="postalCode" value="${esc(draft.postalCode)}" inputmode="numeric" autocomplete="shipping postal-code" maxlength="9" placeholder="00000-000" required><div id="postal-status" class="field-status"></div></div><div class="field-grid street"><div class="field"><label for="street">Rua *</label><input id="street" name="street" value="${esc(draft.street)}" autocomplete="shipping address-line1" maxlength="150" required></div><div class="field"><label for="number">Número *</label><input id="number" name="number" value="${esc(draft.number)}" maxlength="20" required></div></div><div class="field-grid"><div class="field"><label for="district">Bairro *</label><input id="district" name="district" value="${esc(draft.district)}" maxlength="150" required></div><div class="field"><label for="city">Cidade *</label><input id="city" name="city" value="${esc(draft.city)}" maxlength="150" required></div></div><div class="field"><label for="reference">Ponto de referência *</label><input id="reference" name="reference" value="${esc(draft.reference)}" maxlength="150" placeholder="Ex.: ao lado do mercado" required></div><p class="hint">Taxa calculada automaticamente pelo CEP. Se o CEP não identificar seu bairro, consulte a taxa pelo WhatsApp antes de pedir.</p>`;
}
function showCart() {
  setTab("cart");
  if (!cart.length) {
    overlay(
      `<div class="drawer-head"><h2>Seu pedido</h2><button class="icon-button" data-close aria-label="Fechar pedido">×</button></div><div class="empty-cart"><div class="empty-icon">◇</div><h3>A primeira fatia está perto.</h3><p class="muted">Escolha sua pizza para começar.</p><a class="outline" href="/#cardapio" data-close>EXPLORAR CARDÁPIO <span>↗</span></a></div>${
        savedOrders().length
          ? `<div class="last-orders"><h3>Seus últimos pedidos</h3>${savedOrders()
              .map(
                (o) =>
                  `<a href="/pedido/${o.token}">${esc(o.number)} &nbsp; Acompanhar →</a>`,
              )
              .join("")}</div>`
          : ""
      }`,
    );
    return;
  }
  const dialog = overlay(
    `<div class="drawer-head"><h2>Seu pedido</h2><button class="icon-button" data-close aria-label="Fechar pedido">×</button></div><div id="cart-items">${cartItemsHtml()}</div><div class="tabs" role="group" aria-label="Tipo de pedido"><button data-fulfillment="pickup" class="${draft.fulfillment === "pickup" ? "active" : ""}" aria-pressed="${draft.fulfillment === "pickup"}">Retirada</button><button data-fulfillment="delivery" class="${draft.fulfillment === "delivery" ? "active" : ""}" aria-pressed="${draft.fulfillment === "delivery"}">Entrega</button></div><form id="checkout-form">${draft.fulfillment === "pickup" ? `<p class="checkout-pickup">Retirada no Portão<br>${esc(shop.address)}<br>CEP ${esc(shop.postalCode)}</p>` : deliveryFields()}<div class="field"><label for="name">Nome *</label><input id="name" name="name" value="${esc(draft.name)}" autocomplete="name" minlength="2" maxlength="80" required placeholder="Como podemos te chamar?"></div><div class="field"><label for="phone">WhatsApp *</label><input id="phone" name="phone" value="${esc(draft.phone)}" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="16" required placeholder="(21) 99999-9999"></div><label>Forma de pagamento · confirmar no WhatsApp</label><div class="payment-options">${["Pix", "Cartão", "Dinheiro"].map((p) => `<label><input type="radio" name="payment" value="${p}" ${draft.payment === p ? "checked" : ""}><span>${p}</span></label>`).join("")}</div><div id="change-field" ${draft.payment === "Dinheiro" ? "" : "hidden"}><div class="field"><label for="change">Troco para quanto? (opcional)</label><input id="change" name="change" inputmode="decimal" value="${esc(draft.change)}" placeholder="Ex.: 100,00"></div></div><div class="summary"><div class="summary-row"><span>Subtotal</span><span id="summary-subtotal">${money(cartSubtotal())}</span></div><div class="summary-row"><span>Entrega</span><span id="summary-fee">${draft.fulfillment === "pickup" ? "Retirada gratuita" : "Informe o CEP"}</span></div><div class="summary-row total"><strong>Total</strong><strong id="summary-total">${money(cartSubtotal())}</strong></div><p id="quote-message" class="quote-message"></p><p class="form-error error" id="checkout-error" role="alert"></p><p class="notice" id="checkout-availability" ${open ? "hidden" : ""}>${esc(availability?.message || "Consultando disponibilidade de atendimento…")}</p><button class="primary" type="submit" id="submit-order" ${open ? "" : "disabled"}>FINALIZAR PEDIDO <span class="arrow">↗</span></button><p class="hint">Seu pedido é registrado sem cadastro. Na próxima tela, abra o WhatsApp para combinar o pagamento.</p><a class="privacy-link" href="/privacidade">Como usamos seus dados</a></div></form>`,
  );
  $("#checkout-form").addEventListener("input", (e) => {
    if (e.target.name) {
      draft[e.target.name] = e.target.value;
      requestKey = null;
      if (e.target.name === "postalCode") {
        quoteResult = null;
        quoteRevision++;
        $("#summary-fee").textContent = "Consultando CEP";
        $("#summary-total").textContent = "A calcular";
        $("#submit-order").disabled = true;
        clearTimeout(showCart.postalTimer);
        showCart.postalTimer = setTimeout(() => lookupPostal(), 650);
      }
    }
  });
  $("#checkout-form").addEventListener("change", (e) => {
    if (e.target.name === "payment") {
      $("#change-field").hidden = draft.payment !== "Dinheiro";
    }
  });
  $("#checkout-form").onsubmit = submitOrder;
  $$("[data-fulfillment]", dialog).forEach(
    (btn) =>
      (btn.onclick = () => {
        draft.fulfillment = btn.dataset.fulfillment;
        quoteResult = null;
        showCart();
      }),
  );
  updateAvailabilityUI();
  refreshQuote();
}
async function lookupPostal() {
  const cep = draft.postalCode.replace(/\D/g, "");
  if (cep.length !== 8) {
    if ($("#postal-status"))
      $("#postal-status").textContent = "Informe os 8 números do CEP.";
    return;
  }
  const revision = ++quoteRevision;
  const status = $("#postal-status");
  if (status) status.textContent = "Buscando endereço…";
  try {
    const address = await api(`/api/postal/${cep}`);
    if (revision !== quoteRevision) return;
    for (const key of ["street", "district", "city"]) {
      draft[key] = address[key];
      if ($("#" + key)) $("#" + key).value = address[key];
    }
    if (status)
      status.textContent = `${address.district} · ${address.city}/${address.state}`;
    refreshQuote();
  } catch (err) {
    if (revision !== quoteRevision) return;
    quoteResult = null;
    if (status) status.textContent = err.message;
    const message = $("#quote-message");
    if (message) {
      message.textContent = err.message;
      message.classList.add("error-text");
    }
    if ($("#submit-order")) $("#submit-order").disabled = true;
  }
}
async function refreshQuote() {
  const revision = ++quoteRevision;
  quoteResult = null;
  const button = $("#submit-order");
  if (!button) return;
  button.disabled = true;
  if (
    draft.fulfillment === "delivery" &&
    draft.postalCode.replace(/\D/g, "").length !== 8
  ) {
    $("#summary-fee").textContent = "Informe o CEP";
    $("#summary-total").textContent = "A calcular";
    return;
  }
  try {
    const q = await api("/api/quote", {
      method: "POST",
      body: JSON.stringify({
        items: cart,
        fulfillment: draft.fulfillment,
        postalCode: draft.postalCode,
      }),
    });
    if (revision !== quoteRevision || !$("#submit-order")) return;
    quoteResult = q;
    $("#summary-subtotal").textContent = money(q.subtotal);
    $("#summary-fee").textContent = q.fee
      ? money(q.fee)
      : draft.fulfillment === "pickup"
        ? "Retirada gratuita"
        : "Grátis";
    $("#summary-total").textContent = money(q.total);
    $("#quote-message").textContent = q.deliveryZone
      ? `Taxa de entrega incluída no total.`
      : "";
    $("#quote-message").classList.remove("error-text");
    updateAvailabilityUI();
  } catch (err) {
    if (revision !== quoteRevision || !$("#quote-message")) return;
    $("#quote-message").textContent = err.message;
    $("#quote-message").classList.add("error-text");
    $("#summary-fee").textContent = "A confirmar";
    $("#summary-total").textContent = "A calcular";
  }
}
async function submitOrder(e) {
  e.preventDefault();
  if (submitting || !quoteResult) return;
  if (!/^\d{10,11}$/.test(draft.phone.replace(/\D/g, ""))) {
    $("#checkout-error").textContent = "Informe um WhatsApp válido, com DDD.";
    return;
  }
  submitting = true;
  const button = $("#submit-order");
  button.disabled = true;
  button.textContent = "REGISTRANDO PEDIDO…";
  try {
    await refreshAvailability();
    if (!open) return;
    requestKey ||= crypto.randomUUID();
    const change = draft.change
      ? Math.round(Number(draft.change.replace(",", ".")) * 100)
      : null;
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...draft, items: cart, change, requestKey }),
    });
    storeOrder(order);
    cart = [];
    saveCart();
    draft = {
      ...draft,
      name: "",
      phone: "",
      street: "",
      number: "",
      reference: "",
      district: "",
      city: "",
      postalCode: "",
      change: "",
    };
    closeOverlay();
    navigate(`/pedido/${order.token}`);
  } catch (err) {
    if (err.availability) applyAvailability(err.availability);
    else if (!err.status) markAvailabilityUnknown();
    if ($("#checkout-error")) $("#checkout-error").textContent = err.message;
  } finally {
    submitting = false;
    updateAvailabilityUI();
  }
}
function showMenu() {
  overlay(
    `<div class="drawer-head"><span class="eyebrow">DON PADRINO / PIZZARIA</span><button class="icon-button" data-close aria-label="Fechar menu">×</button></div><div class="menu-links"><a href="/" data-close>Início <span class="arrow">↗</span></a><a href="/#cardapio" data-close>Cardápio <span class="arrow">↗</span></a><a href="/#informacoes" data-close>Informações <span class="arrow">↗</span></a><button data-action="cart">Meu pedido <span class="arrow">↗</span></button><a href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp <span class="arrow">↗</span></a></div>`,
    "menu",
    "Menu",
  );
  $(".menu-toggle").setAttribute("aria-expanded", "true");
}
function privacy() {
  main.innerHTML = `<section class="page-shell narrow"><a class="back-link" href="/">← Voltar para a pizzaria</a><p class="eyebrow">DON PADRINO / PRIVACIDADE</p><h1>Seu pedido, seus dados.</h1><div class="privacy-copy"><p>Para preparar e entregar seu pedido, a Don Padrino Pizzaria (CNPJ ${esc(shop.cnpj)}) utiliza seu nome, telefone, itens, observações, forma de pagamento e endereço de entrega, quando aplicável. Não é necessário criar uma conta.</p><p>O pedido fica registrado no sistema da pizzaria. Ao abrir o WhatsApp, você escolhe enviar o resumo do pedido para nosso atendimento. Não informe números de cartão, senhas ou dados bancários nas observações.</p><p>O link de acompanhamento funciona como uma chave privada do seu pedido. Compartilhe apenas com pessoas de confiança. O navegador guarda o carrinho e os links dos seus últimos pedidos para facilitar o retorno; você pode apagá-los limpando os dados do site.</p><p>Se o entregador autorizar o compartilhamento pelo navegador, o acompanhamento exibe sua última localização informada durante a entrega. O entregador pode interromper o compartilhamento. A localização não é coletada do cliente.</p><p>Para solicitar acesso, correção ou exclusão de dados pessoais, fale com a pizzaria pelo <a href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener noreferrer" class="tracking-link">WhatsApp (21) 99456-8096</a>. Dados necessários ao cumprimento de obrigações legais podem ser conservados pelo prazo aplicável.</p><p>A consulta de CEP utiliza o ViaCEP. O mapa utiliza o OpenStreetMap. Ao abrir serviços externos, aplicam-se também as políticas desses serviços.</p></div></section>`;
}
async function route() {
  cleanupPage();
  cleanupPage = () => {};
  closeOverlay();
  clearInterval(slideTimer);
  window.scrollTo(0, 0);
  try {
    const fresh = await api("/api/menu");
    shop = fresh.shop;
    applyAvailability(fresh.availability);
    if (location.pathname === "/admin") {
      setTab("");
      const { mountAdmin } = await import("./admin.js");
      cleanupPage = await mountAdmin(main, shop, (newShop) => {
        shop = newShop;
      });
    } else if (location.pathname.startsWith("/pedido/")) {
      setTab("cart");
      const { mountOrder } = await import("./order.js");
      cleanupPage = await mountOrder(
        main,
        location.pathname.split("/")[2],
        shop,
      );
    } else if (location.pathname.startsWith("/entregador/")) {
      setTab("");
      const { mountCourier } = await import("./order.js");
      cleanupPage = await mountCourier(main, location.pathname.split("/")[2]);
    } else if (location.pathname === "/privacidade") {
      setTab("");
      privacy();
    } else if (location.pathname === "/") {
      renderHome();
    } else {
      main.innerHTML =
        '<section class="page-shell narrow"><h1>Página não encontrada.</h1><a class="outline" href="/">VOLTAR AO INÍCIO ↗</a></section>';
    }
    updateAvailabilityUI();
  } catch (err) {
    main.innerHTML = `<section class="page-shell narrow"><h1>Não foi possível abrir esta página.</h1><p class="error">${esc(err.message)}</p><a class="outline" href="/">VOLTAR AO INÍCIO ↗</a></section>`;
  }
}
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (
    link &&
    link.origin === location.origin &&
    !link.target &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey
  ) {
    if (link.pathname === location.pathname && link.hash) {
      closeOverlay();
      setTimeout(
        () =>
          $(link.hash)?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
          }),
        10,
      );
      return;
    }
    e.preventDefault();
    navigate(link.pathname + link.hash);
    return;
  }
  const target = e.target.closest("button");
  if (!target) return;
  if (target.dataset.action === "cart") {
    e.preventDefault();
    showCart();
  }
  if (target.dataset.action === "menu") showMenu();
  if (target.dataset.product) openProduct(target.dataset.product);
  if (target.dataset.add) {
    if (!shop.drinksConfirmed) return;
    addItem(target.dataset.add);
  }
  if ("slide" in target.dataset) setSlide(Number(target.dataset.slide));
  if (target.dataset.slideStep)
    setSlide(slide + Number(target.dataset.slideStep));
  if ("cartQty" in target.dataset) {
    const i = Number(target.dataset.cartQty);
    cart[i].quantity = Math.min(
      30,
      cart[i].quantity + Number(target.dataset.step),
    );
    cart = cart.filter((i) => i.quantity > 0);
    saveCart();
    showCart();
  }
  if ("remove" in target.dataset) {
    cart.splice(Number(target.dataset.remove), 1);
    saveCart();
    showCart();
  }
});
window.addEventListener("popstate", route);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAvailability().catch(markAvailabilityUnknown);
});
setInterval(() => {
  if (!document.hidden) refreshAvailability().catch(markAvailabilityUnknown);
}, 30000);
try {
  const data = await api("/api/menu");
  products = data.products;
  shop = data.shop;
  applyAvailability(data.availability);
  cart = cart.filter((i) => products.some((p) => p.id === i.id));
  updateCartBadge();
  await route();
} catch (err) {
  main.innerHTML = `<section class="page-shell narrow"><h1>Nosso forno já volta.</h1><p class="error">${esc(err.message)}</p><a class="outline" href="https://wa.me/5521994568096" target="_blank" rel="noopener noreferrer">PEDIR PELO WHATSAPP ↗</a></section>`;
}

main.addEventListener("pointermove", (event) => {
  const hero = event.target.closest(".hero");
  if (
    !hero ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    event.pointerType === "touch"
  )
    return;
  const rect = hero.getBoundingClientRect();
  hero.style.setProperty(
    "--pointer-x",
    `${((event.clientX - rect.left) / rect.width - 0.5) * 10}px`,
  );
  hero.style.setProperty(
    "--pointer-y",
    `${((event.clientY - rect.top) / rect.height - 0.5) * 10}px`,
  );
});
main.addEventListener("pointerleave", () => {
  const hero = $(".hero");
  if (hero) {
    hero.style.setProperty("--pointer-x", "0px");
    hero.style.setProperty("--pointer-y", "0px");
  }
});
