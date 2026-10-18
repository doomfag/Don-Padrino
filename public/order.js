import {
  $,
  $$,
  esc,
  money,
  date,
  api,
  toast,
  navigate,
  statusLabels,
  whatsappUrl,
  storeOrder,
} from "./lib.js";
const statusCopy = {
  awaiting_payment: [
    "Pedido registrado.",
    "Abra o WhatsApp para combinar o pagamento. O preparo começa após a pizzaria confirmar o recebimento.",
  ],
  preparing: [
    "Sua pizza está no forno.",
    "Pagamento recebido. Estamos preparando seu pedido com todo o cuidado.",
  ],
  ready: ["Seu pedido está pronto.", "Sua pizza já está pronta."],
  out_for_delivery: [
    "A caminho da sua casa.",
    "Seu pedido foi entregue ao entregador. Acompanhe as atualizações por aqui.",
  ],
  delivered: [
    "Bom apetite!",
    "Seu pedido foi concluído pela pizzaria. Obrigado por escolher a Don Padrino.",
  ],
  cancelled: [
    "Pedido cancelado.",
    "Para esclarecer o motivo ou combinar um eventual reembolso, fale com a pizzaria pelo WhatsApp.",
  ],
};
export async function mountOrder(main, token, shop) {
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new Error("Link de pedido inválido.");
  let order = await api(`/api/orders/${token}`),
    source,
    disposed = false;
  storeOrder(order);
  function render() {
    const copy = statusCopy[order.status],
      delivery = order.fulfillment === "delivery";
    const flow = delivery
      ? [
          "awaiting_payment",
          "preparing",
          "ready",
          "out_for_delivery",
          "delivered",
        ]
      : ["awaiting_payment", "preparing", "ready", "delivered"];
    const index = flow.indexOf(order.status);
    main.innerHTML = `<section class="page-shell narrow"><a class="back-link" href="/">← Voltar para a pizzaria</a><p class="eyebrow">DON PADRINO / ${esc(order.number)}</p><h1>Seu pedido, por aqui.</h1><p class="muted">${date(order.createdAt)} · ${esc(order.name)}</p><div class="status-box"><span class="status-pill">${esc(statusLabels[order.status])}</span><h2>${esc(copy[0])}</h2><p>${order.status === "ready" ? (delivery ? "Estamos organizando a saída com o entregador." : "Pode vir buscar no portão. Sua pizza está esperando por você.") : esc(copy[1])}</p>${order.status !== "cancelled" ? `<ol class="steps">${flow.map((s, i) => `<li class="${i <= index ? "done" : ""} ${i === index ? "current" : ""}" ${i === index ? 'aria-current="step"' : ""}>${s === "awaiting_payment" ? "Pagamento" : s === "preparing" ? "Preparo" : s === "ready" ? "Pronto" : s === "out_for_delivery" ? "A caminho" : delivery ? "Entregue" : "Retirado"}</li>`).join("")}</ol>` : ""}<div id="eta-display"></div>${order.status === "awaiting_payment" ? `<a class="primary green" href="${esc(whatsappUrl(order, shop))}" target="_blank" rel="noopener noreferrer">COMBINAR PAGAMENTO NO WHATSAPP <span class="arrow">↗</span></a><p class="hint">A mensagem vai pronta com o número, os itens, o endereço e o total. No WhatsApp, toque em Enviar.</p>` : ""}<div class="connection-state" id="order-connection">Conectando ao acompanhamento…</div></div>${delivery && order.status === "out_for_delivery" ? `<section class="order-card" id="location-card"><h2>Seu entregador</h2><div id="location-content"></div></section>` : ""}<section class="order-card"><h2>O que vai chegar</h2>${order.items.map((i) => `<div class="order-item"><div>${i.quantity}× ${esc(i.name)}<small>${i.type === "pizza" ? "35 cm · 8 fatias" : ""}${i.note ? "<br>" + esc(i.note) : ""}</small></div><strong>${money(i.price * i.quantity)}</strong></div>`).join("")}<div class="summary"><div class="summary-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div class="summary-row"><span>${delivery ? "Entrega" : "Retirada"}</span><span>${order.fee ? money(order.fee) : "Grátis"}</span></div><div class="summary-row total"><strong>Total</strong><strong>${money(order.total)}</strong></div></div><div class="order-details"><div><label>${delivery ? "Entregar em" : "Retirar em"}</label><p>${delivery ? `${esc(order.address.street)}, ${esc(order.address.number)}<br>${esc(order.address.district)}, ${esc(order.address.city)}<br>CEP ${esc(order.address.postalCode)}<br>Referência: ${esc(order.address.reference)}` : esc(shop.address)}</p></div><div><label>Pagamento</label><p>${esc(order.payment)}${order.change ? ` · Troco para ${money(order.change)}` : ""}</p><p class="${order.paid ? "paid" : "unpaid"}">${order.paid ? "Recebido pela pizzaria" : "Pendente de confirmação"}</p></div></div></section><section class="order-card"><h2>Atualizações do pedido</h2><ol class="history-list">${order.history.map((h) => `<li><span>${esc(statusLabels[h.status])}</span><time datetime="${esc(h.at)}">${date(h.at)}</time></li>`).join("")}</ol></section><div class="tracking-tools"><button class="outline" id="copy-order">COPIAR LINK DO PEDIDO <span>↗</span></button><a class="outline" href="${esc(whatsappUrl(order, shop))}" target="_blank" rel="noopener noreferrer">FALAR COM A PIZZARIA <span>↗</span></a></div><p class="receipt-note">Guarde este link: ele é a chave privada para acompanhar seu pedido. Não é necessário criar uma conta.</p></section>`;
    $("#copy-order").onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Link do pedido copiado.");
      } catch {
        toast("Copie o endereço desta página para guardar seu pedido.");
      }
    };
    updateTimed();
    connection(source?.readyState === EventSource.OPEN);
  }
  function connection(connected) {
    const el = $("#order-connection");
    if (el) {
      el.classList.toggle("connected", connected);
      el.textContent = connected
        ? "Atualizações em tempo real ativas"
        : "Reconectando… A última atualização continua visível.";
    }
  }
  function updateTimed() {
    const eta = $("#eta-display");
    if (
      eta &&
      order.eta &&
      !["delivered", "cancelled"].includes(order.status)
    ) {
      const minutes = Math.ceil((new Date(order.eta) - Date.now()) / 60000);
      eta.innerHTML = `<p class="tracking-summary">${minutes > 0 ? `Estimativa de tempo: cerca de ${minutes} min.` : "A previsão informada está sendo atualizada pela pizzaria."}</p>`;
    }
    const loc = $("#location-content");
    if (!loc) return;
    if (!order.location) {
      loc.innerHTML =
        '<p class="muted">O entregador ainda não compartilhou a localização. O status do pedido continua sendo atualizado aqui.</p>';
      return;
    }
    const { latitude: lat, longitude: lon, accuracy, at } = order.location;
    const stale = Date.now() - new Date(at) > 120000;
    const key = `${lat},${lon}`;
    if (loc.dataset.location !== key) {
      loc.dataset.location = key;
      loc.innerHTML = `<p class="tracking-summary" id="gps-freshness"></p><iframe class="tracking-map" title="Última localização compartilhada pelo entregador" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.006}%2C${lat - 0.004}%2C${lon + 0.006}%2C${lat + 0.004}&layer=mapnik&marker=${lat}%2C${lon}"></iframe><p class="tracking-summary">Precisão aproximada do GPS: ${Math.round(accuracy)} m.</p><a class="tracking-link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}">Abrir mapa ↗</a>`;
    }
    $("#gps-freshness").textContent =
      `${stale ? "Sem localização recente. Último sinal" : "Último sinal"}: ${date(at)}. A posição depende do GPS e da conexão do entregador.`;
  }
  render();
  source = new EventSource(`/api/orders/${token}/events`);
  source.onopen = () => connection(true);
  source.onerror = () => connection(false);
  source.onmessage = (e) => {
    try {
      const next = JSON.parse(e.data);
      if (disposed) return;
      const changed =
        next.status !== order.status ||
        next.paid !== order.paid ||
        next.eta !== order.eta;
      order = next;
      if (changed) render();
      else {
        updateTimed();
        connection(true);
      }
    } catch {}
  };
  const timer = setInterval(updateTimed, 15000);
  return () => {
    disposed = true;
    source.close();
    clearInterval(timer);
  };
}
export async function mountCourier(main, token) {
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new Error("Link de entrega inválido.");
  let order = await api(`/api/courier/${token}`),
    watch = null,
    lastSent = 0,
    stopped = false,
    inFlight = false,
    disposed = false,
    pendingGps = Promise.resolve();
  main.innerHTML = `<section class="page-shell narrow"><p class="eyebrow">DON PADRINO / ENTREGADOR</p><h1>Entrega ${esc(order.number)}</h1><div class="order-card"><h2>Destino</h2><p>${esc(order.address.street)}, ${esc(order.address.number)}<br>${esc(order.address.district)} — ${esc(order.address.city)}<br>Referência: ${esc(order.address.reference)}</p><p id="courier-status" class="status-label">${esc(statusLabels[order.status])}</p></div><div class="gps-indicator" aria-hidden="true">⌖</div><h2>Compartilhar localização</h2><p class="muted">Compartilhe sua posição somente durante esta entrega. O cliente verá o último sinal recebido e o horário da atualização.</p><p class="hint">O navegador pedirá sua autorização. Mantenha esta página aberta e o celular com localização e internet ativas. O compartilhamento pode ser interrompido ao bloquear a tela.</p><button class="primary green" id="gps-start">ATIVAR LOCALIZAÇÃO <span class="arrow">↗</span></button><button class="outline" id="gps-stop" hidden>PARAR COMPARTILHAMENTO</button><p class="notice" id="gps-message" role="status">${order.status === "out_for_delivery" ? "Pronto para começar." : "Aguarde a pizzaria marcar o pedido como “Saiu para entrega”."}</p><p class="hint">Este link é privado e funciona somente para esta entrega. Não compartilhe com outras pessoas.</p></section>`;
  const start = $("#gps-start"),
    stop = $("#gps-stop"),
    message = $("#gps-message");
  start.disabled = order.status !== "out_for_delivery";
  async function stopSharing(clear = true) {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    stopped = true;
    start.hidden = false;
    stop.hidden = true;
    if (clear) {
      try {
        await pendingGps.catch(() => {});
        await api(`/api/courier/${token}`, { method: "DELETE" });
      } catch {}
    }
  }
  start.onclick = () => {
    if (!navigator.geolocation) {
      message.textContent =
        "Seu navegador não oferece localização. Use um navegador atualizado.";
      return;
    }
    if (!window.isSecureContext) {
      message.textContent =
        "A localização precisa de uma conexão HTTPS segura.";
      return;
    }
    stopped = false;
    start.hidden = true;
    stop.hidden = false;
    message.textContent = "Aguardando sua autorização e um sinal de GPS…";
    watch = navigator.geolocation.watchPosition(
      async (position) => {
        if (stopped || disposed || inFlight || Date.now() - lastSent < 10000)
          return;
        inFlight = true;
        try {
          await (pendingGps = api(`/api/courier/${token}`, {
            method: "POST",
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }),
          }));
          lastSent = Date.now();
          message.textContent = `Localização compartilhada às ${new Date().toLocaleTimeString("pt-BR")}. Mantenha esta página aberta.`;
        } catch (err) {
          message.textContent = err.message;
          if (err.status === 400) await stopSharing();
        } finally {
          inFlight = false;
        }
      },
      async (err) => {
        message.textContent =
          err.code === 1
            ? "Permissão de localização negada. Ative nas configurações do navegador para compartilhar."
            : err.code === 2
              ? "Sinal de GPS indisponível. Confira a localização do celular."
              : "Aguardando sinal de GPS. Tente em uma área aberta.";
        if (err.code === 1) await stopSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };
  stop.onclick = async () => {
    await stopSharing();
    message.textContent = "Compartilhamento interrompido.";
  };
  const timer = setInterval(async () => {
    try {
      order = await api(`/api/courier/${token}`);
      if (disposed) return;
      $("#courier-status").textContent = statusLabels[order.status];
      start.disabled = order.status !== "out_for_delivery";
      if (order.status !== "out_for_delivery" && watch !== null) {
        await stopSharing();
        message.textContent = "Entrega encerrada. Localização interrompida.";
      }
    } catch {}
  }, 10000);
  return () => {
    disposed = true;
    clearInterval(timer);
    stopSharing();
  };
}
