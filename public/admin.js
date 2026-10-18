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
} from "./lib.js";
export async function mountAdmin(main, initialShop, onShopChange) {
  let shop = initialShop,
    orders = [],
    source = null,
    disposed = false,
    tab = "orders",
    filter = "active",
    query = "";
  const session = await api("/api/admin/session");
  async function login() {
    main.innerHTML = `<section class="login-panel"><p class="eyebrow">DON PADRINO / GESTÃO</p><h1>Bem-vindo de volta.</h1><p>Seus pedidos, do primeiro clique à última entrega.</p>${session.configured ? `<form id="login-form"><div class="field"><label for="admin-password">Senha de administrador</label><input id="admin-password" type="password" autocomplete="current-password" required maxlength="256"></div><p class="form-error error" id="login-error" role="alert"></p><button class="primary green" type="submit">ENTRAR NO PAINEL <span class="arrow">↗</span></button></form>` : '<div class="notice">O acesso administrativo precisa ser ativado pelo responsável pela instalação. Nenhuma senha padrão é utilizada.</div>'}<a class="back-link" href="/" style="margin-top:25px;margin-bottom:0">← Voltar para a pizzaria</a></section>`;
    if ($("#login-form"))
      $("#login-form").onsubmit = async (e) => {
        e.preventDefault();
        const button = $("#login-form button");
        button.disabled = true;
        try {
          await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({ password: $("#admin-password").value }),
          });
          await dashboard();
        } catch (err) {
          $("#login-error").textContent = err.message;
          button.disabled = false;
        }
      };
  }
  async function fetchOrders() {
    const next = await api("/api/admin/orders");
    const visible = (list) =>
      JSON.stringify(list.map(({ location, ...order }) => order));
    const changed = visible(orders) !== visible(next);
    orders = next;
    if (!disposed && tab === "orders" && changed) renderOrderList();
  }
  async function dashboard() {
    shop = await api("/api/admin/settings");
    main.innerHTML = `<section class="page-shell"><div class="admin-top"><div><p class="eyebrow">DON PADRINO / GESTÃO</p><h1>À frente da cozinha.</h1></div><div><a class="outline" href="/">VER SITE ↗</a> <button class="outline" id="admin-logout">SAIR</button></div></div><div class="admin-tabs" role="group" aria-label="Área do painel"><button data-admin-tab="orders" class="active">Pedidos</button><button data-admin-tab="settings">Configurações</button></div><div id="admin-content"></div></section>`;
    $("#admin-logout").onclick = async () => {
      try {
        await api("/api/admin/logout", { method: "POST", body: "{}" });
        source?.close();
        session.authenticated = false;
        await login();
      } catch (err) {
        toast(err.message);
      }
    };
    $$("[data-admin-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          tab = button.dataset.adminTab;
          $$("[data-admin-tab]").forEach((b) =>
            b.classList.toggle("active", b === button),
          );
          if (tab === "orders") {
            renderOrdersShell();
            fetchOrders().catch((e) => toast(e.message));
          } else renderSettings();
        }),
    );
    renderOrdersShell();
    await fetchOrders();
    source?.close();
    source = new EventSource("/api/admin/events");
    source.onmessage = () =>
      fetchOrders().catch((e) => {
        if (e.status === 401) {
          source.close();
          toast("Sua sessão expirou. Entre novamente.");
          login();
        }
      });
    source.onerror = () => {
      const el = $("#admin-connection");
      if (el) el.textContent = "Reconectando ao painel…";
    };
    source.onopen = () => {
      const el = $("#admin-connection");
      if (el) el.textContent = "Pedidos atualizados em tempo real";
    };
  }
  function renderOrdersShell() {
    $("#admin-content").innerHTML =
      `<div class="stats" id="admin-stats"></div><p class="connection-state connected" id="admin-connection">Pedidos atualizados em tempo real</p><div class="admin-filters"><input id="order-search" type="search" placeholder="Buscar por número, nome ou telefone" aria-label="Buscar pedidos" value="${esc(query)}"><select id="order-filter" aria-label="Filtrar pedidos"><option value="active">Em andamento</option><option value="all">Todos os pedidos</option><option value="awaiting_payment">Aguardando pagamento</option><option value="preparing">Em preparo</option><option value="ready">Prontos</option><option value="out_for_delivery">Em entrega</option><option value="delivered">Concluídos</option><option value="cancelled">Cancelados</option></select></div><div id="admin-orders"></div>`;
    $("#order-filter").value = filter;
    $("#order-search").oninput = (e) => {
      query = e.target.value;
      renderOrderList();
    };
    $("#order-filter").onchange = (e) => {
      filter = e.target.value;
      renderOrderList();
    };
    renderOrderList();
  }
  function renderOrderList() {
    if (!$("#admin-orders")) return;
    const active = orders.filter(
      (o) => !["delivered", "cancelled"].includes(o.status),
    );
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    const daily = orders.filter(
      (o) =>
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "America/Sao_Paulo",
        }).format(new Date(o.createdAt)) === today,
    );
    $("#admin-stats").innerHTML =
      `<div class="stat"><span>Em andamento</span><strong>${active.length}</strong></div><div class="stat"><span>Aguardando pagamento</span><strong>${active.filter((o) => !o.paid).length}</strong></div><div class="stat"><span>Pedidos hoje</span><strong>${daily.length}</strong></div><div class="stat"><span>Recebido hoje *</span><strong>${money(daily.filter((o) => o.paid && o.status !== "cancelled").reduce((s, o) => s + o.total, 0))}</strong></div>`;
    const selected = orders.filter(
      (o) =>
        (filter === "all" ||
          (filter === "active" &&
            !["delivered", "cancelled"].includes(o.status)) ||
          filter === o.status) &&
        `${o.number} ${o.name} ${o.phone}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    $("#admin-orders").innerHTML = selected.length
      ? selected
          .map(
            (o) =>
              `<article class="admin-order" data-order-id="${o.id}"><div class="admin-order-top"><div><h3>${esc(o.number)} · ${esc(o.name)}</h3><p>${date(o.createdAt)} · ${o.fulfillment === "pickup" ? "Retirada no Portão" : "Entrega"}</p><span class="status-label">${esc(statusLabels[o.status])}</span></div><div><strong>${money(o.total)}</strong><span class="status-label ${o.paid ? "paid" : "unpaid"}">${o.paid ? "Pagamento recebido" : "Pagamento pendente"}</span></div></div><div class="admin-order-items">${o.items.map((i) => `<p>${i.quantity}× ${esc(i.name)} · ${money(i.price * i.quantity)}${i.note ? `<br><small class="muted">↳ ${esc(i.note)}</small>` : ""}</p>`).join("")}</div><div class="admin-order-meta">${o.address ? `${esc(o.address.street)}, ${esc(o.address.number)} — ${esc(o.address.district)}, ${esc(o.address.city)} · CEP ${esc(o.address.postalCode)}<br>Referência: ${esc(o.address.reference)}<br>` : ""}${esc(o.payment)}${o.change ? ` · Troco para ${money(o.change)}` : ""} · Entrega: ${o.fee ? money(o.fee) : "Grátis"}<br><a class="tracking-link" href="https://wa.me/55${esc(o.phone)}" target="_blank" rel="noopener noreferrer">WhatsApp do cliente ↗</a> &nbsp; <a class="tracking-link" href="/pedido/${o.token}" target="_blank" rel="noopener noreferrer">Acompanhamento ↗</a>${o.eta ? `<br>Previsão: ${date(o.eta)}` : ""}</div><div class="admin-actions">${!["delivered", "cancelled"].includes(o.status) ? `${!o.paid ? `<button class="primary green" data-paid="${o.id}">CONFIRMAR PAGAMENTO</button>` : ""}${o.paid && o.status === "awaiting_payment" ? `<button class="primary green" data-status="preparing" data-id="${o.id}">INICIAR PREPARO</button>` : ""}${o.status === "preparing" ? `<button class="primary green" data-status="ready" data-id="${o.id}">PEDIDO PRONTO</button>` : ""}${o.status === "ready" ? `<button class="primary green" data-status="${o.fulfillment === "pickup" ? "delivered" : "out_for_delivery"}" data-id="${o.id}">${o.fulfillment === "pickup" ? "CONFIRMAR RETIRADA" : "ENTREGUE AO ENTREGADOR"}</button>` : ""}${o.status === "out_for_delivery" ? `<button class="primary green" data-status="delivered" data-id="${o.id}">CONFIRMAR ENTREGA</button><button class="outline" data-courier="${o.courierToken}">COPIAR LINK DO ENTREGADOR ↗</button>` : ""}<label for="eta-${o.id}" class="sr-only">Previsão em minutos</label><input id="eta-${o.id}" type="number" min="0" max="240" placeholder="Min" aria-label="Previsão em minutos"><button class="outline" data-eta="${o.id}">DEFINIR PREVISÃO</button><button class="inline-button danger-text" data-cancel="${o.id}">Cancelar pedido</button>` : ""}${o.status === "cancelled" && o.paid ? '<p class="hint">Pagamento confirmado antes do cancelamento. Confira se há reembolso a combinar.</p>' : ""}</div><p class="form-error error" data-error-for="${o.id}" role="alert"></p></article>`,
          )
          .join("")
      : '<div class="no-orders">Nenhum pedido nesta seleção.</div>';
    $("#admin-orders").insertAdjacentHTML(
      "beforeend",
      '<p class="hint">* Soma dos pedidos criados hoje, marcados como pagos e não cancelados. Inclui entrega. Últimos 300 pedidos exibidos; não substitui um relatório financeiro.</p>',
    );
    $$("[data-paid]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !confirm("Você conferiu o recebimento do pagamento deste pedido?")
          )
            return;
          await update(b.dataset.paid, { paid: true }, b);
        }),
    );
    $$("[data-status]").forEach(
      (b) =>
        (b.onclick = () =>
          update(b.dataset.id, { status: b.dataset.status }, b)),
    );
    $$("[data-cancel]").forEach(
      (b) =>
        (b.onclick = () => {
          if (
            confirm(
              "Cancelar este pedido? Se já foi pago, combine o reembolso com o cliente.",
            )
          )
            update(b.dataset.cancel, { status: "cancelled" }, b);
        }),
    );
    $$("[data-eta]").forEach(
      (b) =>
        (b.onclick = () => {
          const input = $(`#eta-${b.dataset.eta}`);
          if (!input.value || !input.checkValidity()) {
            toast(
              "Informe a previsão de 0 a 240 minutos. Zero remove a previsão.",
            );
            return;
          }
          update(b.dataset.eta, { etaMinutes: Number(input.value) }, b);
        }),
    );
    $$("[data-courier]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              `${location.origin}/entregador/${b.dataset.courier}`,
            );
            toast("Link privado do entregador copiado.");
          } catch {
            toast("Não foi possível copiar. Autorize a área de transferência.");
          }
        }),
    );
  }
  async function update(id, payload, button) {
    button.disabled = true;
    try {
      await api(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await fetchOrders();
      toast("Pedido atualizado.");
    } catch (err) {
      const error = $(`[data-error-for="${id}"]`);
      if (error) error.textContent = err.message;
      button.disabled = false;
    }
  }
  let ruleDraft = [];
  function ruleMarkup(r, i) {
    return `<div class="rule" data-rule="${i}"><div class="field"><label>Nome da região</label><input data-rule-field="name" value="${esc(r.name)}" required maxlength="150"></div><div class="field"><label>CEP inicial</label><input data-rule-field="start" value="${esc(r.start)}" inputmode="numeric" maxlength="9" required></div><div class="field"><label>CEP final</label><input data-rule-field="end" value="${esc(r.end)}" inputmode="numeric" maxlength="9" required></div><div class="field"><label>Taxa (R$)</label><input data-rule-field="fee" value="${(r.fee / 100).toFixed(2)}" inputmode="decimal" required></div><button type="button" class="icon-button danger-text" data-remove-rule="${i}" aria-label="Remover região">×</button></div>`;
  }
  function bindRules() {
    const root = $("#delivery-rules");
    root.innerHTML = ruleDraft.map(ruleMarkup).join("");
    $$("[data-rule-field]", root).forEach(
      (input) =>
        (input.oninput = () => {
          const i = Number(input.closest("[data-rule]").dataset.rule),
            key = input.dataset.ruleField;
          ruleDraft[i][key] =
            key === "fee" ? parseMoney(input.value) : input.value;
        }),
    );
    $$("[data-remove-rule]", root).forEach(
      (b) =>
        (b.onclick = () => {
          ruleDraft.splice(Number(b.dataset.removeRule), 1);
          bindRules();
        }),
    );
  }
  const parseMoney = (value) =>
    Math.round(Number(String(value).replace(",", ".")) * 100);
  function renderSettings() {
    ruleDraft = structuredClone(shop.deliveryRules);
    $("#admin-content").innerHTML =
      `<form class="settings-form" id="shop-settings"><h2>Informações da pizzaria</h2><div class="field"><label for="shop-address">Endereço de retirada</label><input id="shop-address" name="address" value="${esc(shop.address)}" required maxlength="250"></div><div class="field"><label for="shop-postal">CEP da pizzaria</label><input id="shop-postal" name="postalCode" value="${esc(shop.postalCode)}" maxlength="9" required></div><div class="field"><label for="shop-hours">Horário exibido</label><input id="shop-hours" name="hours" value="${esc(shop.hours)}" required maxlength="250"></div><p class="hint">A abertura automática segue quinta a domingo, 18h às 00h, no horário de Brasília. O texto acima informa o cliente; para mudar os dias e horários automáticos, ajuste a regra do servidor.</p><label class="checkbox"><input type="checkbox" name="acceptingOrders" ${shop.acceptingOrders ? "checked" : ""}> Aceitar pedidos (desmarque para pausar)</label><label class="checkbox"><input type="checkbox" name="enforceHours" ${shop.enforceHours ? "checked" : ""}> Aceitar somente durante o horário de funcionamento</label><label class="checkbox"><input type="checkbox" name="drinksConfirmed" ${shop.drinksConfirmed ? "checked" : ""}> Disponibilizar Guaraná 2L a R$ 12 e Coca-Cola 2L a R$ 14</label><div class="field"><label for="shop-notice">Aviso no site (opcional)</label><textarea id="shop-notice" name="notice" maxlength="500" placeholder="Ex.: Hoje a cozinha está com alta demanda.">${esc(shop.notice)}</textarea></div><h2>Prazos de preparo e entrega</h2><div class="field"><label for="prep-minutes">Preparo estimado (minutos)</label><input id="prep-minutes" type="number" min="5" max="180" value="${shop.prepMinutes}" required></div><p class="hint">Ao iniciar o preparo, a previsão soma este prazo ao tempo estimado da região. Ao sair para entrega, o prazo da região começa a contar novamente. Você pode ajustar a previsão de cada pedido. São estimativas operacionais, sem cálculo de trânsito.</p><h2>Taxas por região</h2><p class="hint">O CEP é consultado no ViaCEP. O bairro retornado identifica a região. Urucânia e Dumas podem aparecer como Santa Cruz; nesses casos será aplicada a taxa de Santa Cruz. Use as faixas de CEP abaixo quando precisar de uma exceção precisa.</p><div class="field-grid">${shop.deliveryRates.map((r, i) => `<div class="field"><label for="rate-${i}">${esc(r.name)} (R$)</label><input id="rate-${i}" data-rate="${i}" value="${(r.fee / 100).toFixed(2)}" inputmode="decimal" required><label for="minutes-${i}" style="margin-top:10px">Tempo em entrega (minutos)</label><input id="minutes-${i}" type="number" min="1" max="120" value="${r.minutes}" required></div>`).join("")}</div><h2>Exceções por faixa de CEP</h2><p class="hint">Opcional. As faixas têm prioridade sobre o bairro e não podem se sobrepor. Informe somente CEPs que você realmente atende. Taxa zero significa entrega grátis.</p><div id="delivery-rules"></div><button class="outline" type="button" id="add-rule">+ ADICIONAR FAIXA DE CEP</button><div class="separator"></div><p class="form-error error" id="settings-error" role="alert"></p><button class="primary green" type="submit" id="save-settings">SALVAR CONFIGURAÇÕES <span>↗</span></button><p class="hint">As alterações são aplicadas a novos pedidos. Os valores dos pedidos já registrados são preservados.</p></form>`;
    bindRules();
    $("#add-rule").onclick = () => {
      ruleDraft.push({ name: "", start: "", end: "", fee: 0 });
      bindRules();
    };
    $("#shop-settings").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target,
        data = new FormData(form),
        button = $("#save-settings");
      button.disabled = true;
      try {
        const input = {
          prepMinutes: Number($("#prep-minutes").value),
          address: data.get("address"),
          postalCode: data.get("postalCode"),
          hours: data.get("hours"),
          notice: data.get("notice"),
          acceptingOrders: data.has("acceptingOrders"),
          enforceHours: data.has("enforceHours"),
          drinksConfirmed: data.has("drinksConfirmed"),
          deliveryRules: ruleDraft,
          deliveryRates: shop.deliveryRates.map((r, i) => ({
            ...r,
            fee: parseMoney($(`#rate-${i}`).value),
            minutes: Number($(`#minutes-${i}`).value),
          })),
        };
        shop = await api("/api/admin/settings", {
          method: "PUT",
          body: JSON.stringify(input),
        });
        onShopChange(shop);
        toast("Configurações salvas.");
        $("#settings-error").textContent = "";
      } catch (err) {
        $("#settings-error").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  if (session.authenticated) await dashboard();
  else await login();
  return () => {
    disposed = true;
    source?.close();
  };
}
